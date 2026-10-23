import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteSetting, loadSetting, saveSettings } from '@/services/storage/settings';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('设备设置批量持久化', () => {
  it('服务端写入失败时仍落 IDB，设置不会白点保存', async () => {
    const firstKey = `atomic-first-${crypto.randomUUID()}`;
    const secondKey = `atomic-second-${crypto.randomUUID()}`;
    const baseFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/saves/mutate')) {
        return new Response('forced failure', { status: 500 });
      }
      return baseFetch(input, init);
    });

    await expect(saveSettings([
      [firstKey, { value: 'written-first' }],
      [secondKey, { value: 'written-second' }],
    ])).resolves.toBeUndefined();

    expect(await loadSetting(firstKey)).toEqual({ value: 'written-first' });
    expect(await loadSetting(secondKey)).toEqual({ value: 'written-second' });
    vi.unstubAllGlobals();
    await deleteSetting(firstKey);
    await deleteSetting(secondKey);
  });
});
