// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TurnItem } from '@/components/features/Chat/TurnItem';
import { 创建空解析回复, type 聊天消息 } from '@/models/chat';
import { 创建空相册系统 } from '@/models/imageGeneration';

describe('正文插图：消息插图丢失时从相册回退', () => {
  it('消息 narrativeImages 为空，但相册有同消息 targetId 的图时仍渲染', () => {
    const message: 聊天消息 = {
      id: 'msg_1',
      role: 'assistant',
      content: '正文',
      timestamp: 0,
      parsedResponse: 创建空解析回复(),
    };
    const album = 创建空相册系统();
    album.assets.push({
      id: 'asset_1',
      url: 'https://example.com/fallback.png',
      source: 'generated',
      nsfw: false,
      createdAt: 0,
      status: 'ready',
    });
    album.entries.push({
      id: 'album_1',
      assetId: 'asset_1',
      title: '正文插图',
      targetType: 'scene',
      targetId: 'msg_1',
      slot: 'scene',
      tags: [],
      nsfw: false,
      createdAt: 0,
      referenceTargets: [],
    });

    render(
      <TurnItem
        message={message}
        album={album}
        插图显示={{ 默认显示: true, 默认展开: true }}
      />,
    );

    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/fallback.png');
  });
});
