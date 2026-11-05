/**
 * 本地磁盘存档模式的客户端存储层。
 *
 * 目标（Phase A）：浏览器只把「本地服务」当作存档唯一真相——
 * 启动读 catalog/当前档，每回合按需读写单行；不再整库回灌 IndexedDB。
 * 没有本地服务（纯静态部署、测试）时由调用方退回 IndexedDB 旧路径。
 *
 * 本文件不依赖 node:fs，只走 `/api/saves`。
 */
import type { 存档数据 } from '@/models/settings';
import type { SaveCatalogSnapshot } from '@/contracts/storage';
import { UNIFIED_ID_DB_VERSION } from '@/utils/id';
import { devLog } from '@/utils/devLog';
import { blobToDataUrl } from '@/utils/albumObjectUrl';
import {
  LOCAL_SAVE_API_PREFIX,
  type LocalSaveMutation,
  type LocalSaveStoreName,
} from '@/services/localSave/saveStoreSchema';
import {
  buildSaveCatalogSnapshot,
  createCatalogRecordFromSummary,
  createHiddenDeltaBaseCatalogRecord,
  normalizeSaveCatalogRecord,
  type SaveCatalogRecord,
} from './saveCatalog';
import {
  buildSaveSummary,
  isUnsealedHeadSave,
  normalizeSaveType,
} from './saveSummary';
import {
  isDeltaOnlyStoredSave,
  restoreSaveFromDelta,
  type SaveNodeDeltaRecord,
} from '@/utils/saveDeltaStorage';
import type { SaveAssetRecord } from '@/utils/saveAssetStorage';

export type SaveStorageMode = 'disk' | 'idb';

const HEALTH_TIMEOUT_MS = 800;
const PAGE_LIMIT = 50;
const MAX_PAGES = 2000;

let mode: SaveStorageMode | null = null;
let probing: Promise<SaveStorageMode> | null = null;
let nextSaveId: number | null = null;
let idQueue: Promise<unknown> = Promise.resolve();

function isTestMode(): boolean {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    return env?.MODE === 'test';
  } catch {
    return false;
  }
}

async function probe(): Promise<SaveStorageMode> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const response = await fetch(`${LOCAL_SAVE_API_PREFIX}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (!response.ok) {
      mode = 'idb';
      return mode;
    }
    const data = await response.json() as { ok?: boolean };
    mode = data?.ok === true ? 'disk' : 'idb';
  } catch {
    mode = 'idb';
  }
  return mode;
}

/** 解析一次并缓存。测试环境直接走 IDB，避免给既有用例引入网络请求。 */
export async function getSaveStorageMode(): Promise<SaveStorageMode> {
  if (mode) return mode;
  if (isTestMode()) {
    mode = 'idb';
    return mode;
  }
  if (!probing) probing = probe();
  return probing;
}

export function currentSaveStorageMode(): SaveStorageMode {
  return mode ?? 'idb';
}

/** 仅测试/诊断使用：强制指定模式，传 null 恢复自动探测。 */
export function setSaveStorageModeForTests(next: SaveStorageMode | null): void {
  mode = next;
  probing = null;
  nextSaveId = null;
  idQueue = Promise.resolve();
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${LOCAL_SAVE_API_PREFIX}${path}`, {
    ...init,
    cache: 'no-store',
    headers: init?.body ? { 'content-type': 'application/json', ...(init.headers ?? {}) } : init?.headers,
  });
  if (!response.ok) {
    throw new Error(`本地存档服务返回 HTTP ${response.status}`);
  }
  return await response.json() as T;
}

export async function diskGetRow<T>(store: LocalSaveStoreName, key: string | number): Promise<T | null> {
  const data = await apiJson<{ rows?: T[] }>(`/store/${store}?key=${encodeURIComponent(String(key))}`);
  return data.rows?.[0] ?? null;
}

export async function diskListRows<T>(
  store: LocalSaveStoreName,
  options: { tail?: number } = {},
): Promise<T[]> {
  if (options.tail !== undefined) {
    const data = await apiJson<{ rows?: T[] }>(`/store/${store}?tail=${options.tail}`);
    return data.rows ?? [];
  }
  const rows: T[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (after !== null) query.set('after', after);
    const data = await apiJson<{ rows?: T[]; nextAfterKey?: string | null }>(
      `/store/${store}?${query.toString()}`,
    );
    rows.push(...(data.rows ?? []));
    after = data.nextAfterKey ?? null;
    if (!after) break;
  }
  return rows;
}

export async function diskListKeys(store: LocalSaveStoreName): Promise<string[]> {
  const data = await apiJson<{ keys?: string[] }>(`/store/${store}?keys=1`);
  return data.keys ?? [];
}

export async function diskFindSaveIdByNodeId(nodeId: string): Promise<number | null> {
  const query = new URLSearchParams({ path: 'saveTree.nodeId', value: nodeId });
  const data = await apiJson<{ id?: number | null }>(`/find/saves?${query.toString()}`);
  return typeof data.id === 'number' && data.id > 0 ? data.id : null;
}

export async function diskMutate(mutation: Omit<LocalSaveMutation, 'dbVersion'>): Promise<void> {
  await apiJson('/mutate', {
    method: 'POST',
    body: JSON.stringify({
      dbVersion: UNIFIED_ID_DB_VERSION,
      updatedAt: Date.now(),
      ...mutation,
    } satisfies LocalSaveMutation),
  });
}

export async function diskPut(store: LocalSaveStoreName, rows: unknown[]): Promise<void> {
  if (!rows.length) return;
  await diskMutate({ puts: { [store]: rows } });
}

export async function diskDelete(store: LocalSaveStoreName, keys: Array<string | number>): Promise<void> {
  if (!keys.length) return;
  await diskMutate({ deletes: { [store]: keys } });
}

/** 分配下一个存档 id（本地文件没有 autoIncrement）。 */
export function allocateDiskSaveId(): Promise<number> {
  const task = idQueue.then(async () => {
    if (nextSaveId === null) {
      const keys = await diskListKeys('saves');
      let max = 0;
      for (const key of keys) {
        const parsed = Number(key);
        if (Number.isFinite(parsed) && parsed > max) max = parsed;
      }
      nextSaveId = max + 1;
    }
    const id = nextSaveId;
    nextSaveId += 1;
    return id;
  });
  idQueue = task.catch(() => undefined);
  return task;
}

export async function diskLoadRawSave(id: number): Promise<存档数据 | null> {
  return await diskGetRow<存档数据>('saves', id);
}

export async function diskLoadDeltaRecord(nodeId: string): Promise<SaveNodeDeltaRecord | null> {
  return await diskGetRow<SaveNodeDeltaRecord>('saveNodeDeltas', nodeId);
}

export async function diskRestoreDeltaSaveIfNeeded(
  save: 存档数据,
  visited = new Set<number>(),
): Promise<存档数据> {
  if (!isDeltaOnlyStoredSave(save)) return save;
  const saveId = save.id || 0;
  if (visited.has(saveId)) return save;
  visited.add(saveId);
  const tree = (save as 存档数据 & { saveTree?: import('@/utils/saveTree').存档树元信息 }).saveTree;
  if (!tree?.nodeId) return save;
  const delta = await diskLoadDeltaRecord(tree.nodeId);
  const baseSaveId = delta?.deltaPayload?.baseSaveId
    ?? (save as 存档数据 & { saveStorage?: { baseSaveId?: number } }).saveStorage?.baseSaveId;
  if (!delta || !baseSaveId) return save;
  const rawBase = await diskLoadRawSave(baseSaveId);
  if (!rawBase) return save;
  const base = await diskRestoreDeltaSaveIfNeeded(rawBase, visited);
  return restoreSaveFromDelta(base, save, delta);
}

export async function diskReadAllDeltaRecords(): Promise<SaveNodeDeltaRecord[]> {
  return await diskListRows<SaveNodeDeltaRecord>('saveNodeDeltas');
}

export async function diskFindAutoDeltaBase(
  save: 存档数据,
): Promise<{ baseSave: 存档数据; baseSaveId: number } | null> {
  if (save.type !== 'auto') return null;
  const tree = (save as 存档数据 & { saveTree?: import('@/utils/saveTree').存档树元信息 }).saveTree;
  if (!tree?.parentNodeId) return null;
  const records = await diskReadCatalogRecords();
  const parentSummary = records.find((record) => {
    if (!('saveTree' in record)) return false;
    return record.saveTree?.nodeId === tree.parentNodeId;
  }) as (SaveCatalogRecord & { id: number; unsealedHead?: boolean; saveTree?: { nodeId?: string } }) | undefined;
  if (!parentSummary?.id) return null;
  const parentSave = await diskLoadRawSave(parentSummary.id);
  if (!parentSave) return null;
  if (parentSummary.unsealedHead === true || isUnsealedHeadSave(parentSave)) {
    devLog('save', 'disk-delta-base-skipped-unsealed-head', {
      saveId: parentSummary.id,
      nodeId: tree.parentNodeId,
    });
    return null;
  }
  const parentIsDelta = isDeltaOnlyStoredSave(parentSave);
  let baseSaveId: number | null = null;
  if (parentIsDelta) {
    baseSaveId = (parentSave as 存档数据 & { saveStorage?: { baseSaveId?: number } }).saveStorage?.baseSaveId ?? null;
    if (!baseSaveId && tree.nodeId) {
      const delta = await diskLoadDeltaRecord(tree.nodeId);
      baseSaveId = delta?.deltaPayload?.baseSaveId ?? null;
    }
  } else {
    baseSaveId = parentSummary.id;
  }
  if (!baseSaveId) return null;
  const deltas = await diskReadAllDeltaRecords();
  const nodes = new Set(
    deltas
      .filter((delta) => delta.deltaPayload?.baseSaveId === baseSaveId)
      .map((delta) => delta.nodeId || `save:${delta.saveId}`),
  );
  if (nodes.size >= 5) return null;
  const baseSave = !parentIsDelta && baseSaveId === parentSummary.id
    ? parentSave
    : await diskLoadRawSave(baseSaveId);
  if (!baseSave || isDeltaOnlyStoredSave(baseSave)) return null;
  return { baseSave, baseSaveId };
}

export async function diskReadCatalogRecords(): Promise<SaveCatalogRecord[]> {
  const rows = await diskListRows<unknown>('saveSummaries');
  const records: SaveCatalogRecord[] = [];
  for (const value of rows) {
    const normalized = normalizeSaveCatalogRecord(value);
    if (normalized) {
      records.push(normalized);
      continue;
    }
    if (value && typeof value === 'object' && 'chatHistory' in value) {
      records.push(createCatalogRecordFromSummary(buildSaveSummary(value as 存档数据)));
    }
  }
  return records;
}

export async function diskGetCatalogSnapshot(): Promise<SaveCatalogSnapshot> {
  const [records, keys] = await Promise.all([
    diskReadCatalogRecords(),
    diskListKeys('saves'),
  ]);
  return buildSaveCatalogSnapshot(records, keys);
}

export async function diskLoadAssetRecords(assetIds: string[]): Promise<SaveAssetRecord[]> {
  if (!assetIds.length) return [];
  const rows = await Promise.all(assetIds.map((id) => diskGetRow<SaveAssetRecord>('saveAssets', id)));
  return rows.filter((record): record is SaveAssetRecord => Boolean(record?.id));
}

/** 磁盘行只能放 JSON：把 Blob 资产转成 dataUrl，否则 JSON.stringify 会丢字节。 */
export async function diskSerializeAssetRecords(records: SaveAssetRecord[]): Promise<SaveAssetRecord[]> {
  const output: SaveAssetRecord[] = [];
  for (const record of records) {
    if (record.blob) {
      const dataUrl = await blobToDataUrl(record.blob);
      output.push({ ...record, dataUrl, blob: undefined });
    } else if (record.dataUrl || record.originalUrl) {
      output.push({ ...record, blob: undefined });
    }
  }
  return output;
}

export interface DiskSaveGraph {
  save: 存档数据;
  summary: SaveCatalogRecord;
  delta?: SaveNodeDeltaRecord | null;
  assets?: SaveAssetRecord[];
  deletedDeltaSaveIds?: number[];
}

export async function diskWriteSaveGraph(graph: DiskSaveGraph): Promise<void> {
  const puts: LocalSaveMutation['puts'] = {
    saves: [graph.save],
    saveSummaries: [graph.summary],
  };
  if (graph.delta) puts.saveNodeDeltas = [graph.delta];
  if (graph.assets?.length) puts.saveAssets = graph.assets;
  const deletes: LocalSaveMutation['deletes'] = {};
  if (graph.deletedDeltaSaveIds?.length) {
    deletes.saveNodeDeltas = graph.deletedDeltaSaveIds;
  }
  await diskMutate({
    puts,
    ...(Object.keys(deletes).length ? { deletes } : {}),
  });
}

export async function diskDeleteManagedSaveItems(
  candidates: Array<{ id: number }>,
): Promise<void> {
  if (!candidates.length) return;
  const [deltas, records] = await Promise.all([
    diskReadAllDeltaRecords(),
    diskReadCatalogRecords(),
  ]);
  const referenced = new Set<number>();
  for (const delta of deltas) {
    if (delta.deltaPayload?.baseSaveId) referenced.add(delta.deltaPayload.baseSaveId);
  }
  const putSaves: unknown[] = [];
  const putSummaries: unknown[] = [];
  const deleteSaves: number[] = [];
  const deleteSummaries: number[] = [];
  const deleteDeltas: string[] = [];
  for (const item of candidates) {
    const deltaKeys = deltas
      .filter((delta) => delta.saveId === item.id)
      .map((delta) => delta.nodeId);
    deleteDeltas.push(...deltaKeys);
    if (referenced.has(item.id)) {
      const row = await diskLoadRawSave(item.id);
      if (row) {
        putSaves.push({
          ...row,
          saveRuntime: { ...(row as { saveRuntime?: Record<string, unknown> }).saveRuntime, hiddenDeltaBase: true },
        });
        putSummaries.push(createHiddenDeltaBaseCatalogRecord({
          id: item.id,
          type: normalizeSaveType(row.type),
          timestamp: row.timestamp || 0,
        }));
      }
    } else {
      deleteSaves.push(item.id);
      deleteSummaries.push(item.id);
    }
  }
  await diskMutate({
    puts: {
      ...(putSaves.length ? { saves: putSaves } : {}),
      ...(putSummaries.length ? { saveSummaries: putSummaries } : {}),
    },
    deletes: {
      ...(deleteSaves.length ? { saves: deleteSaves } : {}),
      ...(deleteSummaries.length ? { saveSummaries: deleteSummaries } : {}),
      ...(deleteDeltas.length ? { saveNodeDeltas: deleteDeltas } : {}),
    },
  });
  // 只保留仍被 delta 引用的 hidden base；其余清掉。
  const orphanHidden = records
    .filter((record) => record.visibility === 'hidden-delta-base' && !referenced.has(record.id))
    .map((record) => record.id);
  if (orphanHidden.length) {
    await diskMutate({
      deletes: { saves: orphanHidden, saveSummaries: orphanHidden },
    });
  }
}
