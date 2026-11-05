/**
 * 向量派生缓存：只存“文本 → 向量”，可随时重建，不进存档。
 *
 * 使用独立的 IndexedDB 数据库，避免和存档库的版本/迁移纠缠；
 * 浏览器禁用 IndexedDB 时退回进程内 Map（本次会话仍可用）。
 */

const DB_NAME = 'kaituo_memory_vectors';
const DB_VERSION = 1;
const STORE = 'vectors';
const memoryFallback = new Map<string, Float32Array>();

interface VectorRecord {
  key: string;
  model: string;
  hash: string;
  dim: number;
  vector: Float32Array;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        // 向量是可重建的派生数据；仍尽量申请持久化，减少被浏览器清理的概率。
        if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
          void navigator.storage.persist().catch(() => undefined);
        }
        resolve(request.result);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function cacheKey(model: string, hash: string): string {
  return `${model}::${hash}`;
}

export async function loadVectorCache(model: string, hashes: string[]): Promise<Map<string, Float32Array>> {
  const result = new Map<string, Float32Array>();
  if (!hashes.length) return result;
  const db = await openDb();
  if (!db) {
    for (const hash of hashes) {
      const vector = memoryFallback.get(cacheKey(model, hash));
      if (vector) result.set(hash, vector);
    }
    return result;
  }

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE, 'readonly');
    const store = transaction.objectStore(STORE);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    transaction.oncomplete = finish;
    transaction.onerror = finish;
    transaction.onabort = finish;
    for (const hash of hashes) {
      const request = store.get(cacheKey(model, hash));
      request.onsuccess = () => {
        const record = request.result as VectorRecord | undefined;
        if (record?.vector instanceof Float32Array && record.vector.length) {
          result.set(hash, record.vector);
        }
      };
    }
  });
  for (const [hash, vector] of result) memoryFallback.set(cacheKey(model, hash), vector);
  return result;
}

export async function saveVectorCache(
  model: string,
  items: Array<{ hash: string; vector: Float32Array; dim: number }>,
): Promise<void> {
  if (!items.length) return;
  for (const item of items) memoryFallback.set(cacheKey(model, item.hash), item.vector);
  const db = await openDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const now = Date.now();
    for (const item of items) {
      const record: VectorRecord = {
        key: cacheKey(model, item.hash),
        model,
        hash: item.hash,
        dim: item.dim,
        vector: item.vector,
        updatedAt: now,
      };
      store.put(record);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

export async function clearMemoryVectorCache(model?: string): Promise<void> {
  if (model) {
    for (const key of [...memoryFallback.keys()]) {
      if (key.startsWith(`${model}::`)) memoryFallback.delete(key);
    }
  } else {
    memoryFallback.clear();
  }
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    if (model) {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if ((cursor.value as VectorRecord).model === model) cursor.delete();
        cursor.continue();
      };
    } else {
      store.clear();
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}
