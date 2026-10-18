import { describe, expect, it } from 'vitest';
import { 创建空相册系统 } from '@/models/imageGeneration';
import type { 聊天消息, 叙事插图 } from '@/models/chat';
import { 创建默认文生图系统设置 } from '@/models/genSystem';
import { 归一化文生图系统设置 } from '@/models/settings';
import { 找出丢失缓存插图 } from '@/utils/illustrationCacheRepair';

function 造消息(images: 叙事插图[]): 聊天消息 {
  return {
    id: 'msg_1',
    role: 'assistant',
    content: '正文',
    timestamp: 0,
    narrativeImages: images,
  };
}

function 造插图(overrides: Partial<叙事插图> = {}): 叙事插图 {
  return {
    id: 'img_1',
    dataUrl: 'asset:missing',
    type: 'scene',
    kind: 'snapshot',
    prompt: '<image>测试</image>',
    status: 'done',
    ...overrides,
  };
}

function 造相册() {
  const album = 创建空相册系统();
  album.assets.push({
    id: 'present',
    url: 'https://example.com/present.png',
    source: 'generated',
    nsfw: false,
    createdAt: 0,
    status: 'ready',
  });
  return album;
}

describe('插图缓存丢失检测', () => {
  it('只挑出 done 且地址解析不出来的插图', () => {
    const album = 造相册();
    const missing = 找出丢失缓存插图([
      造消息([
        造插图({ id: 'bad', dataUrl: 'asset:missing' }),
        造插图({ id: 'ok', dataUrl: 'https://example.com/a.png' }),
        造插图({ id: 'present', dataUrl: 'asset:present' }),
        造插图({ id: 'inline', dataUrl: 'data:image/png;base64,AAAA' }),
        造插图({ id: 'failed', dataUrl: 'asset:missing', status: 'failed' }),
        造插图({ id: 'generating', dataUrl: 'asset:missing', status: 'generating' }),
        造插图({ id: 'static', dataUrl: 'static:missing.png' }),
      ]),
    ], album);
    expect(missing.map((项) => 项.插图.id)).toEqual(['bad']);
  });

  it('assetId 兜底：dataUrl 为空但 assetId 存在时也按引用判断', () => {
    const album = 造相册();
    const missing = 找出丢失缓存插图([
      造消息([
        造插图({ id: 'ok', dataUrl: '', assetId: 'present' }),
        造插图({ id: 'bad', dataUrl: '', assetId: 'missing' }),
      ]),
    ], album);
    expect(missing.map((项) => 项.插图.id)).toEqual(['bad']);
  });

  it('自动重画默认关闭，打开后归一化保留', () => {
    const 默认 = 创建默认文生图系统设置();
    expect(默认.正文配图.缓存丢失自动重画).toBe(false);
    const 开启 = 归一化文生图系统设置({
      ...默认,
      正文配图: { ...默认.正文配图, 缓存丢失自动重画: true },
    });
    expect(开启.正文配图.缓存丢失自动重画).toBe(true);
  });
});
