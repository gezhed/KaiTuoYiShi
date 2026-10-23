/**
 * 设置读写：优先真实 IndexedDB，服务端文件作为可用时的镜像/旧数据来源。
 *
 * 背景：P-main-2 稳定版把设置放 IndexedDB；后续 disk-only 改成只走服务端文件。
 * 服务端 API 不可用（静态部署、端口被占、返回 500）时，saveSetting 直接抛错，
 * 玩家看到的就是「点了保存没效果」，刷新后剧情编织/设置又回到空白。
 *
 * 现在的口径：
 *   - IDB 是本机真相，写入先落 IDB；
 *   - 服务端可用时同步一份，失败只记日志，不影响保存成功；
 *   - 读取先读 IDB，没有再用服务端旧数据兜底。
 */
import { openDB, SETTINGS_STORE } from './dbConnection';
import { deleteStoreRows, readStoreRow, writeStoreRows } from './fileStore';
import { devLogError } from '@/utils/devLog';
import { toError } from '@/utils/storageUtils';

interface SettingRow<T> {
  key: string;
  value: T;
}

function 剥离游戏设置运行态键(key: string, value: unknown): unknown {
  if (key !== 'gameSettings') return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  if (!('macroGlobalVars' in source) && !('worldbookTriggerStates' in source)) return value;
  const { macroGlobalVars: _macro, worldbookTriggerStates: _trigger, ...rest } = source;
  void _macro;
  void _trigger;
  return rest;
}

async function 读Indexed设置<T>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly');
      const request = tx.objectStore(SETTINGS_STORE).get(key);
      request.onsuccess = () => {
        const result = request.result as { value?: T } | undefined;
        resolve(result?.value ?? null);
      };
      request.onerror = () => reject(toError(request.error));
    });
  } catch {
    return null;
  }
}

async function 写Indexed设置(entries: ReadonlyArray<readonly [string, unknown]>): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE);
    try {
      for (const [key, value] of entries) {
        store.put({ key, value: 剥离游戏设置运行态键(key, value) });
      }
    } catch (error) {
      tx.abort();
      reject(toError(error));
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(toError(tx.error));
    tx.onabort = () => reject(toError(tx.error ?? new Error('设置批量写入已中止。')));
  });
}

async function 删Indexed设置(key: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    tx.objectStore(SETTINGS_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(toError(tx.error));
  });
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await saveSettings([[key, value]]);
}

export async function saveSettings(entries: ReadonlyArray<readonly [string, unknown]>): Promise<void> {
  if (!entries.length) return;
  const rows = entries.map(([key, value]) => ({ key, value: 剥离游戏设置运行态键(key, value) }));
  let indexedError: unknown = null;
  try {
    await 写Indexed设置(entries);
  } catch (error) {
    indexedError = error;
  }
  // 服务端只做异步镜像：绝不阻塞保存按钮。服务端挂起/不可达时，IDB 已经保存成功。
  void writeStoreRows('settings', rows).catch((error) => {
    devLogError('save', 'settings-disk-mirror-failed', error);
  });
  if (indexedError) throw toError(indexedError);
}

export async function loadSetting<T>(key: string): Promise<T | null> {
  const local = await 读Indexed设置<T>(key);
  if (local !== null) return local;
  try {
    const row = await Promise.race([
      readStoreRow<SettingRow<T>>('settings', key),
      new Promise<null>((resolve) => { globalThis.setTimeout(() => resolve(null), 1200); }),
    ]);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function deleteSetting(key: string): Promise<void> {
  try {
    await 删Indexed设置(key);
  } catch (error) {
    devLogError('save', 'settings-indexed-delete-failed', error);
  }
  void deleteStoreRows('settings', [key]).catch((error) => {
    devLogError('save', 'settings-disk-delete-failed', error);
  });
}
