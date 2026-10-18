import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteSetting, loadSetting, saveSettings } from '@/services/storage/settings';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('设备设置批量持久化', () => {
  it('服务端写入失败时整批不落库', async () => {
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
    ])).rejects.toBeInstanceOf(Error);

    expect(await loadSetting(firstKey)).toBeNull();
    expect(await loadSetting(secondKey)).toBeNull();
    vi.unstubAllGlobals();
    await deleteSetting(firstKey);
    await deleteSetting(secondKey);
  });
});
