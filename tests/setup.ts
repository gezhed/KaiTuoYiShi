import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * 存储层已逐步改为走服务端文件（`/api/saves/*`）。
 * 测试环境里没有服务端，所以在这里补一个**内存版**：只拦截 `/api/saves/`，其余请求原样放行。
 * 这也是去 IDB 改造的一部分 —— 以后所有存储测试都跑在这上面。
 */
const STORE_KEYS: Record<string, string> = {
  saves: 'id',
  saveSummaries: 'id',
  saveAssets: 'id',
  saveNodeDeltas: 'nodeId',
  settings: 'key',
  newestStory: 'key',
};
const memoryStores = new Map<string, Map<string, unknown>>();
function storeOf(name: string): Map<string, unknown> {
  const existing = memoryStores.get(name);
  if (existing) return existing;
  const created = new Map<string, unknown>();
  memoryStores.set(name, created);
  return created;
}
function keyOf(name: string, row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const keyPath = STORE_KEYS[name];
  if (!keyPath) return null;
  const value = (row as Record<string, unknown>)[keyPath];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  let url: URL;
  try {
    url = new URL(raw, 'http://local.test');
  } catch {
    return realFetch(input, init);
  }
  if (!url.pathname.startsWith('/api/saves/')) return realFetch(input, init);

  const rest = url.pathname.slice('/api/saves/'.length);
  if (rest === 'mutate' && (init?.method ?? 'GET').toUpperCase() === 'POST') {
    const rawBody = typeof init?.body === 'string' ? init.body : '{}';
    const body = JSON.parse(rawBody) as {
      puts?: Record<string, unknown[]>;
      deletes?: Record<string, string[]>;
      clears?: string[];
    };
    for (const name of body.clears ?? []) memoryStores.set(name, new Map());
    for (const [name, rows] of Object.entries(body.puts ?? {})) {
      const store = storeOf(name);
      for (const row of rows) {
        const key = keyOf(name, row);
        if (key !== null) store.set(key, row);
      }
    }
    for (const [name, keys] of Object.entries(body.deletes ?? {})) {
      const store = storeOf(name);
      for (const key of keys) store.delete(key);
    }
    return json({ ok: true, updatedAt: Date.now() });
  }

  if (rest.startsWith('store/')) {
    const name = rest.slice('store/'.length);
    const store = storeOf(name);
    const key = url.searchParams.get('key');
    if (key !== null) {
      const row = store.get(key);
      return json({ ok: true, store: name, rows: row ? [row] : [] });
    }
    let rows = [...store.values()];
    const tail = url.searchParams.get('tail');
    if (tail !== null) {
      rows = rows.slice(-Math.max(1, Number(tail) || 1));
      return json({ ok: true, store: name, rows, nextAfterKey: null });
    }
    const after = url.searchParams.get('after');
    if (after) {
      const index = rows.findIndex((row) => String(keyOf(name, row)) === after);
      if (index >= 0) rows = rows.slice(index + 1);
    }
    const limit = Number(url.searchParams.get('limit') ?? '50') || 50;
    const page = rows.slice(0, limit);
    return json({ ok: true, store: name, rows: page, nextAfterKey: page.length < rows.length ? keyOf(name, page[page.length - 1]) : null });
  }

  return json({ ok: true });
});

vi.mock('@/utils/devLog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/devLog')>();
  return {
    ...actual,
    devLog: vi.fn(),
    devLogError: vi.fn(),
  };
});

beforeEach(() => {
  // 每个用例一套干净的内存库，避免设置/存档跨用例污染（测试之间必须相互隔离）。
  memoryStores.clear();
});

afterEach(cleanup);
