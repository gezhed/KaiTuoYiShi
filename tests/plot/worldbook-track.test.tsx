// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlotPanel } from '@/components/features/GameSystems/PlotPanel';
import { 创建空API设置, 创建默认游戏设置 } from '@/models/settings';
import { createStoryWeavingFixture } from '../prompts/fixtures';
import type { 剧情编织系统 } from '@/models/storyWeaving';

function worldbookSystem(): 剧情编织系统 {
  const fixture = createStoryWeavingFixture();
  const source = fixture.系列列表[0];
  const worldbook = {
    ...source,
    id: 'wb_main_amphoreus_test',
    标题: '【主线·翁法罗斯 3.6】于长夜重返大地',
    作品名: '崩坏：星穹铁道·银河球棒侠传说',
    来源类型: 'canon' as const,
    剧情来源: '世界书' as const,
    剧情分类: '主线' as const,
    剧情地区: '翁法罗斯',
    剧情版本: '3.6',
    分段列表: source.分段列表.map((segment, index) => ({
      ...segment,
      id: `wb_segment_${index}`,
      剧情分类: '主线' as const,
      剧情地区: '翁法罗斯',
      剧情版本: '3.6',
      运行状态: index === 0 ? ('当前' as const) : ('未开始' as const),
    })),
  };
  return {
    ...fixture,
    当前系列ID: worldbook.id,
    当前进度: {
      当前系列ID: worldbook.id,
      当前分段ID: worldbook.分段列表[0].id,
      当前分段组号: 1,
      推进状态: '推进中',
      已完成摘要: [],
      当前待解问题: [],
      切换说明: [],
      历史归档: [],
      最近判定理由: [],
      updatedAt: 0,
    },
    系列列表: [worldbook],
  };
}

describe('剧情编织世界书轨道', () => {
  it('渲染世界书标签、分类与搜索框', () => {
    const system = worldbookSystem();
    render(
      <PlotPanel
        storyWeaving={system}
        onStoryWeavingChange={vi.fn()}
        gameSettings={创建默认游戏设置()}
        apiSettings={创建空API设置()}
        onSaveStoryWeaving={() => Promise.resolve()}
      />,
    );
    expect(screen.getAllByText('世界书剧情').length).toBeGreaterThan(0);
    expect(screen.getAllByText('【主线·翁法罗斯 3.6】于长夜重返大地').length).toBeGreaterThan(0);
    const search = screen.getByPlaceholderText('搜索系列 / 章节 / 角色 / 地点');
    fireEvent.change(search, { target: { value: '翁法罗斯' } });
    expect(screen.getAllByText('【主线·翁法罗斯 3.6】于长夜重返大地').length).toBeGreaterThan(0);
    fireEvent.change(search, { target: { value: '不存在的关键词' } });
    expect(screen.getByText('没有匹配的剧情系列或分段，试试缩短关键词。')).toBeTruthy();
  });
});
