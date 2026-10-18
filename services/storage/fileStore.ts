/**
 * 服务端文件存储适配层（**取代 IndexedDB**）。
 *
 * 设计口径与 SillyTavern 一致：
 *   - **唯一真相 = 服务端 `save/` 目录里的文件**；
 *   - 浏览器**不保留任何持久副本**（内存里只有当前故事）；
 *   - 读：`GET /api/saves/store/<表>`（支持 `?key=` 单行、分页）；
 *   - 写：`POST /api/saves/mutate`（服务端原子写文件）。
 *
 * 为什么要有这一层：以前存档写在 IndexedDB 里再镜像到磁盘，于是同一份数据存在两处、
 * 需要"回灌/对账/分片推送"一整套桥接；而 Chrome 的 IndexedDB 位于用户目录（C 盘），
 * 实测单这一个源就吃了 1.55 GB。改成只走服务端文件后，浏览器不再占任何存档空间。
 */
import {
  LOCAL_SAVE_API_PREFIX,
  localSaveStoreKeyPath,
  type LocalSaveStoreName,
} from '@/services/localSave/saveStoreSchema';

/** 与 IndexedDB 版本号解耦：只用于服务端 manifest 记录，不影响读写。 */
const FALLBACK_DB_VERSION = 10;

export interface StoreRowsPage<T> {
  rows: T[];
  nextAfterKey: string | null;
}

function endpoint(path: string): string {
  return `${LOCAL_SAVE_API_PREFIX}${path}`;
}

/** 读一行；不存在返回 null。 */
export async function readStoreRow<T = unknown>(
  store: LocalSaveStoreName,
  key: string | number,
): Promise<T | null> {
  try {
    const response = await fetch(endpoint(`/store/${store}?key=${encodeURIComponent(String(key))}`), {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { rows?: unknown[] };
    const first = Array.isArray(data.rows) ? data.rows[0] : null;
    return (first ?? null) as T | null;
  } catch {
    return null;
  }
}

/** 分页读；`afterKey` 为空表示从第一页开始。 */
export async function readStorePage<T = unknown>(
  store: LocalSaveStoreName,
  options: { afterKey?: string | null; limit?: number; maxBytes?: number } = {},
): Promise<StoreRowsPage<T>> {
  const params = new URLSearchParams();
  params.set('limit', String(options.limit ?? 50));
  if (options.maxBytes !== undefined) params.set('maxBytes', String(options.maxBytes));
  if (options.afterKey) params.set('after', options.afterKey);
  try {
    const response = await fetch(endpoint(`/store/${store}?${params.toString()}`), { cache: 'no-store' });
    if (!response.ok) return { rows: [], nextAfterKey: null };
    const data = (await response.json()) as { rows?: unknown[]; nextAfterKey?: string | null };
    return {
      rows: Array.isArray(data.rows) ? (data.rows as T[]) : [],
      nextAfterKey: data.nextAfterKey ?? null,
    };
  } catch {
    return { rows: [], nextAfterKey: null };
  }
}

/** 读整个表（小表专用：设置、摘要、最新指针）。大表请用分页或单行读取。 */
export async function readWholeStore<T = unknown>(store: LocalSaveStoreName): Promise<T[]> {
  const all: T[] = [];
  let after: string | null = null;
  for (let guard = 0; guard < 200; guard += 1) {
    const page: StoreRowsPage<T> = await readStorePage<T>(store, { afterKey: after, limit: 200 });
    if (!page.rows.length) break;
    all.push(...page.rows);
    if (!page.nextAfterKey) break;
    after = page.nextAfterKey;
  }
  return all;
}

interface MutationPayload {
  puts?: Partial<Record<LocalSaveStoreName, unknown[]>>;
  deletes?: Partial<Record<LocalSaveStoreName, Array<string | number>>>;
  clears?: LocalSaveStoreName[];
}

async function mutate(payload: MutationPayload): Promise<void> {
  const response = await fetch(endpoint('/mutate'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      dbVersion: FALLBACK_DB_VERSION,
      updatedAt: Date.now(),
      puts: payload.puts ?? {},
      deletes: payload.deletes ?? {},
      clears: payload.clears ?? [],
    }),
  });
  if (!response.ok) {
    // 把服务端的具体报错带出来：以前只报“HTTP 500”，排查时完全看不到原因。
    const detail = await response.text().catch(() => '');
    throw new Error(`服务端写入失败：HTTP ${response.status}${detail ? ' ' + detail.slice(0, 300) : ''}`);
  }
}

/** 写若干行（按表分组，一次请求）。行必须自带该表的主键字段。 */
export async function writeStoreRows(store: LocalSaveStoreName, rows: readonly unknown[]): Promise<void> {
  if (!rows.length) return;
  const keyPath = localSaveStoreKeyPath(store);
  const valid = rows.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const key = (row as Record<string, unknown>)[keyPath];
    return key !== undefined && key !== null;
  });
  if (!valid.length) return;
  await mutate({ puts: { [store]: valid } });
}

/** 多表一起写（保证同一事务语义的近似：一次请求提交）。 */
export async function writeStoreRowsBatch(
  puts: Partial<Record<LocalSaveStoreName, readonly unknown[]>>,
): Promise<void> {
  const prepared: Partial<Record<LocalSaveStoreName, unknown[]>> = {};
  for (const [store, rows] of Object.entries(puts) as Array<[LocalSaveStoreName, readonly unknown[] | undefined]>) {
    if (!rows || !rows.length) continue;
    const keyPath = localSaveStoreKeyPath(store);
    const valid = rows.filter((row) => {
      if (!row || typeof row !== 'object') return false;
      const key = (row as Record<string, unknown>)[keyPath];
      return key !== undefined && key !== null;
    });
    if (valid.length) prepared[store] = valid;
  }
  if (!Object.keys(prepared).length) return;
  await mutate({ puts: prepared });
}

/** 删若干行。 */
export async function deleteStoreRows(
  store: LocalSaveStoreName,
  keys: ReadonlyArray<string | number>,
): Promise<void> {
  if (!keys.length) return;
  await mutate({ deletes: { [store]: [...keys] } });
}

/** 清空整张表。 */
export async function clearStoreRows(store: LocalSaveStoreName): Promise<void> {
  await mutate({ clears: [store] });
}
