/**
 * 相册图片的独立持久化库。
 *
 * 和存档树/磁盘镜像分开：图片字节按 assetId 存在自己的 IndexedDB 里，
 * 不参与 saveAssets 的清空/回灌，也不依赖某一片叶子是否引用了它。
 * 对应原型（智绘姬）里 `GalImageDB_Blob` 的 images store。
 */
import { rememberAlbumAssetBlob } from '@/utils/albumObjectUrl';
import { 创建空相册系统, type 相册系统, type 图片资源, type 相册条目 } from '@/models/imageGeneration';

const DB_NAME = 'KaiTuoAlbumImageDB';
const DB_VERSION = 1;
const STORE_NAME = 'images';

interface 相册图片记录 {
  id: string;
  blob: Blob;
  mimeType?: string;
  size?: number;
  title?: string;
  targetType?: string;
  targetId?: string;
  slot?: string;
  prompt?: string;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // 测试/诊断会 deleteDatabase 清库；不处理 versionchange 会一直占着连接，
      // 让删除请求永远 blocked。
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      resolve(null);
    };
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('相册图片库事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('相册图片库事务中止'));
  });
}

/** 出图成功时立即落进独立图片库；refresh 不依赖存档树。 */
export async function 保存相册图片字节(
  assetId: string,
  记录: Omit<相册图片记录, 'id' | 'updatedAt'>,
): Promise<boolean> {
  const id = String(assetId || '').trim();
  if (!id || !(记录.blob instanceof Blob)) return false;
  const db = await openDB();
  if (!db) return false;
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      ...记录,
      id,
      size: 记录.size || 记录.blob.size,
      mimeType: 记录.mimeType || 记录.blob.type,
      updatedAt: Date.now(),
    } satisfies 相册图片记录);
    await txDone(tx);
    return true;
  } catch {
    return false;
  }
}

/** 启动/进档时把所有图片字节读回展示缓存；按 assetId 寻址的相册图即可解析。 */
export async function 载入全部相册图片字节(): Promise<number> {
  const db = await openDB();
  if (!db) return 0;
  try {
    const records = await new Promise<相册图片记录[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as 相册图片记录[]);
      req.onerror = () => reject(req.error ?? new Error('读取相册图片库失败'));
    });
    let loaded = 0;
    for (const record of records) {
      if (!record?.id || !(record.blob instanceof Blob)) continue;
      rememberAlbumAssetBlob(record.id, record.blob, record.mimeType || record.blob.type);
      loaded += 1;
    }
    return loaded;
  } catch {
    return 0;
  }
}

/**
 * 把独立图片库里、当前存档确实引用到的资产补回相册。
 *
 * 相册条目本身如果被旧存档写回冲掉，字节还在独立库里；
 * 这里按 assetId 补一条最小相册记录，至少让玩家重新看到图并下载。
 */
export async function 补齐相册图片记录(save: { 相册?: 相册系统 }): Promise<number> {
  const db = await openDB();
  if (!db) return 0;
  let records: 相册图片记录[] = [];
  try {
    records = await new Promise<相册图片记录[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as 相册图片记录[]);
      req.onerror = () => reject(req.error ?? new Error('读取相册图片库失败'));
    });
  } catch {
    return 0;
  }
  if (!records.length) return 0;
  const album = save.相册 ?? 创建空相册系统();
  const referenced = new Set<string>([
    ...(album.assets ?? []).map((asset) => asset.id),
    ...(album.entries ?? []).map((entry) => entry.assetId),
  ]);
  const shouldRecoverAll = referenced.size === 0;
  const assets = [...(album.assets ?? [])];
  const entries = [...(album.entries ?? [])];
  let added = 0;
  for (const record of records) {
    if (!record?.id || !(record.blob instanceof Blob)) continue;
    rememberAlbumAssetBlob(record.id, record.blob, record.mimeType || record.blob.type);
    if (!shouldRecoverAll && !referenced.has(record.id)) continue;
    if (!assets.some((asset) => asset.id === record.id)) {
      assets.push({
        id: record.id,
        dataUrl: `asset:${record.id}`,
        mimeType: record.mimeType || record.blob.type,
        size: record.size || record.blob.size,
        source: 'generated',
        nsfw: false,
        createdAt: record.updatedAt || Date.now(),
        status: 'ready',
        prompt: record.prompt,
      } satisfies 图片资源);
      added += 1;
    }
    if (!entries.some((entry) => entry.assetId === record.id)) {
      entries.push({
        id: `album_recovered_${record.id}`,
        assetId: record.id,
        title: record.title || '相册图片',
        targetType: (record.targetType as 相册条目['targetType']) || 'misc',
        targetId: record.targetId,
        slot: (record.slot as 相册条目['slot']) || 'misc',
        tags: ['相册恢复'],
        nsfw: false,
        createdAt: record.updatedAt || Date.now(),
        referenceTargets: [],
      });
      added += 1;
    }
  }
  if (added > 0) save.相册 = { ...album, assets, entries };
  return added;
}

/** 只供测试/诊断使用。 */
export function 重置相册图片库连接(): void {
  dbPromise = null;
}
