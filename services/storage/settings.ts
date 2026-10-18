/**
 * 设置读写：**走服务端文件**（`save/store/settings/*.json`），不再进 IndexedDB。
 *
 * 这是"存档与设置彻底离开浏览器"的第一块。数据形态与磁盘上现有的完全一致
 * （每行 `{ key, value }`，主键 `key`），所以不需要任何迁移。
 */
import { deleteStoreRows, readStoreRow, writeStoreRows } from './fileStore';

const SETTINGS_STORE = 'settings' as const;

interface SettingRow<T> {
  key: string;
  value: T;
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await saveSettings([[key, value]]);
}

export async function saveSettings(entries: ReadonlyArray<readonly [key: string, value: unknown]>): Promise<void> {
  if (!entries.length) return;
  await writeStoreRows(
    SETTINGS_STORE,
    entries.map(([key, value]) => ({ key, value: 剥离游戏设置运行态键(key, value) })),
  );
}

export async function loadSetting<T>(key: string): Promise<T | null> {
  const row = await readStoreRow<SettingRow<T>>(SETTINGS_STORE, key);
  return row?.value ?? null;
}

export async function deleteSetting(key: string): Promise<void> {
  await deleteStoreRows(SETTINGS_STORE, [key]);
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
