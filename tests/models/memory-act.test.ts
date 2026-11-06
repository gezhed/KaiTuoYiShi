import { describe, expect, it } from 'vitest';
import type { 记忆事件 } from '@/models/memoryEvent';
import { 从事件派生角色记忆 } from '@/models/characterMemory';
import { 封顶幕记忆, 归一化幕记忆, 整理幕记忆 } from '@/models/memoryAct';

function buildEvent(turn: number, summary: string): 记忆事件 {
  return {
    id: `evt_${turn}`,
    回合: turn,
    摘要: summary,
    参与人: ['Lyra'],
    亲见: [],
    被告知: [],
    不在场: [],
    背景在场: [],
    公开度: '半公开',
    来源: '正文',
    置信: '高',
    创建时间: turn,
  };
}

describe('每幕整理', () => {
  it('把一幕内的事件压成旧幕摘要，并移除已被覆盖的链接', () => {
    const events = Array.from({ length: 6 }, (_, index) => buildEvent(index + 1, `第 ${index + 1} 天的事务。`));
    const links = events.flatMap((event) => 从事件派生角色记忆(event, ['玩家']));
    const result = 整理幕记忆({
      events,
      links,
      组号: 2,
      标题: '港口篇',
      fromTurn: 0,
      currentTurn: 7,
      now: 1000,
    });

    expect(result.act).not.toBeNull();
    expect(result.act).toMatchObject({ 组号: 2, 标题: '港口篇', 起止回合: [1, 6], 事件数: 6 });
    expect(result.act?.摘要).toContain('【第2幕·港口篇】');
    expect(result.act?.摘要).toContain('第1回合');
    expect(result.remainingLinks).toHaveLength(0);
  });

  it('事件不足 6 条时不生成幕记忆', () => {
    const events = Array.from({ length: 5 }, (_, index) => buildEvent(index + 1, '日常。'));
    const result = 整理幕记忆({
      events,
      links: [],
      组号: 1,
      标题: '序章',
      fromTurn: 0,
      currentTurn: 6,
      now: 1000,
    });
    expect(result.act).toBeNull();
  });

  it('只取最有分量的 8 条，冲突事件不会被日常挤掉', () => {
    const events = Array.from({ length: 9 }, (_, index) => buildEvent(index + 1, '日常。'));
    events[4] = buildEvent(5, 'Lyra 与玩家爆发冲突。');
    const result = 整理幕记忆({
      events,
      links: [],
      组号: 3,
      标题: '冲突篇',
      fromTurn: 0,
      currentTurn: 10,
      now: 1000,
    });
    expect(result.act?.摘要).toContain('爆发冲突');
    expect(result.act?.摘要.split('\n')).toHaveLength(9);
  });

  it('归一化时保留合法幕并清掉坏项', () => {
    const issues: string[] = [];
    const valid = {
      id: 'act_1',
      组号: 1,
      标题: '序章',
      起止回合: [1, 6] as [number, number],
      摘要: '【第1幕·序章】\n- 第1回合：开始。',
      事件数: 6,
      角色: ['Lyra'],
      创建时间: 1000,
    };
    const result = 归一化幕记忆([valid, { ...valid }, { id: '' }], issues);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ 组号: 1, 标题: '序章', 事件数: 6 });
    expect(issues.join('')).toContain('非法项');
    expect(封顶幕记忆(result)).toBe(result);
  });
});
