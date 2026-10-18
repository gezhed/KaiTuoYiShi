/**
 * 回归：相册资产必须真正写进磁盘镜像，且磁盘回灌不能反过来冲掉 IDB 里还有的 Blob。
 * 历史故障：saveAssets 的 Blob 被 JSON 序列化成 {}，每次刷新同步都把相册清空。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface CapturedRequest {
  url: string;
  body: unknown;
}

let captured: CapturedRequest[] = [];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function installFetch(pages: Record<string, unknown[]>, updatedAt: number | null = null): void {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const raw = init?.body;
    let body: unknown = null;
    if (typeof raw === 'string') {
      try { body = JSON.parse(raw); } catch { body = raw; }
    }
    captured.push({ url, body });
    const headers = { 'content-type': 'application/json' };
    if (url.includes('/health')) {
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        hasData: updatedAt !== null,
        dbVersion: 10,
        updatedAt,
      }), { status: 200, headers }));
    }
    if (url.includes('/mutate')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, updatedAt: Date.now() }), { status: 200, headers }));
    }
    const store = url.match(/\/store\/([^?/]+)/)?.[1] ?? '';
    return Promise.resolve(new Response(JSON.stringify({
      ok: true,
      store,
      rows: pages[store] ?? [],
      nextAfterKey: null,
    }), { status: 200, headers }));
  }));
}

async function openDb() {
  const mod = await import('@/services/storage/dbConnection');
  const db = await mod.openDB();
  return { db, mod };
}

async function putAsset(row: Record<string, unknown>): Promise<void> {
  const { db, mod } = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(mod.SAVE_ASSETS_STORE, 'readwrite');
    tx.objectStore(mod.SAVE_ASSETS_STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error instanceof Error ? tx.error : new Error('put failed'));
  });
}

async function readAsset(id: string): Promise<Record<string, unknown> | undefined> {
  const { db, mod } = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(mod.SAVE_ASSETS_STORE, 'readonly');
    const req = tx.objectStore(mod.SAVE_ASSETS_STORE).get(id);
    req.onsuccess = () => resolve(req.result as Record<string, unknown> | undefined);
    req.onerror = () => reject(req.error instanceof Error ? req.error : new Error('get failed'));
  });
}

function readMutateAssetRows(body: unknown): Array<Record<string, unknown>> {
  if (!body || typeof body !== 'object') return [];
  const puts = (body as { puts?: unknown }).puts;
  if (!puts || typeof puts !== 'object') return [];
  const rows = (puts as { saveAssets?: unknown }).saveAssets;
  return Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object')) : [];
}

beforeEach(async () => {
  vi.resetModules();
  captured = [];
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  } satisfies Storage);
  // 不能在这里先 openDB：openDB 会缓存未安装镜像的原始连接，
  // 之后 bootstrap 装 sink 也拦不到本次测试的写入。
  // 两个用例使用不同 asset id，互不干扰。
});

describe('本地落盘 · 相册资产', () => {
  it('saveAssets 的 Blob 写盘时转成 dataUrl，不丢字节', async () => {
    installFetch({}, null);
    const { bootstrapDiskPersistence } = await import('@/services/storage/diskPersistence');
    await bootstrapDiskPersistence();

    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
    await putAsset({ id: 'asset_mirror_test', blob, mimeType: 'image/png', size: blob.size, updatedAt: Date.now() });
    await new Promise((resolve) => setTimeout(resolve, 450));

    const rows = captured.flatMap((item) => item.url.includes('/mutate') ? readMutateAssetRows(item.body) : []);
    const row = rows.find((item) => item.id === 'asset_mirror_test');
    expect(row).toBeDefined();
    expect(row?.blob).toBeUndefined();
    expect(String(row?.dataUrl)).toMatch(/^data:image\/png;base64,/);
  });

  it('磁盘只有无字节的旧资产行时，不覆盖 IDB 里仍有 Blob 的记录', async () => {
    const blob = new Blob([new Uint8Array([9, 8, 7])], { type: 'image/png' });
    await putAsset({ id: 'asset_existing', blob, mimeType: 'image/png', size: blob.size, updatedAt: Date.now() });
    installFetch({ saveAssets: [{ id: 'asset_existing', mimeType: 'image/png', size: 3 }] }, 5000);

    const { bootstrapDiskPersistence } = await import('@/services/storage/diskPersistence');
    await bootstrapDiskPersistence();

    const after = await readAsset('asset_existing');
    expect(after?.blob).toBeInstanceOf(Blob);
  });
});
