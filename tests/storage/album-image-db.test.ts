import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAlbumAssetObjectUrlCache, getAlbumAssetBlob } from '@/utils/albumObjectUrl';
import { 保存相册图片字节, 载入全部相册图片字节, 重置相册图片库连接, 补齐相册图片记录 } from '@/utils/albumImageDB';
import { 创建空相册系统 } from '@/models/imageGeneration';

beforeEach(() => {
  clearAlbumAssetObjectUrlCache();
 重置相册图片库连接();
});

describe('相册独立图片库', () => {
  it('刷新后不依赖存档树也能按 assetId 取回 Blob', async () => {
    const id = `asset_album_db_${Date.now()}`;
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
    expect(await 保存相册图片字节(id, {
      blob,
      mimeType: 'image/png',
      size: blob.size,
      title: '正文插图',
      targetType: 'scene',
      slot: 'scene',
    })).toBe(true);

    clearAlbumAssetObjectUrlCache();
    expect(await 载入全部相册图片字节()).toBeGreaterThan(0);
    const loaded = getAlbumAssetBlob(id);
    expect(loaded).toBeInstanceOf(Blob);
    expect(loaded?.size).toBe(blob.size);
  });

  it('相册条目被旧存档冲掉时，按独立库补回最小记录', async () => {
    const id = `asset_album_recover_${Date.now()}`;
    const blob = new Blob([new Uint8Array([5, 6, 7])], { type: 'image/png' });
    expect(await 保存相册图片字节(id, {
      blob,
      mimeType: 'image/png',
      size: blob.size,
      title: '正文插图',
      targetType: 'scene',
      slot: 'scene',
    })).toBe(true);

    clearAlbumAssetObjectUrlCache();
    const save: { 相册: ReturnType<typeof 创建空相册系统> } = { 相册: 创建空相册系统() };
    expect(await 补齐相册图片记录(save)).toBeGreaterThan(0);
    expect(save.相册.assets.some((asset) => asset.id === id)).toBe(true);
    expect(save.相册.entries.some((entry) => entry.assetId === id)).toBe(true);
  });
});
