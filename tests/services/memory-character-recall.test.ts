import { describe, expect, it } from 'vitest';
import { 创建NPC记录 } from '@/models/npc';
import { 从事件派生角色记忆 } from '@/models/characterMemory';
import type { 记忆事件 } from '@/models/memoryEvent';
import { buildCharacterMemoryInjection, 选择在场角色 } from '@/services/memoryCharacterRecall';

function buildEvent(overrides: Partial<记忆事件> = {}): 记忆事件 {
  return {
    id: 'evt_1_1000',
    回合: 1,
    地点: '港口',
    摘要: '玩家与三月七在港口交接货物。',
    参与人: ['三月七'],
    亲见: [],
    被告知: [],
    不在场: [],
    背景在场: [],
    公开度: '半公开',
    来源: '正文',
    置信: '高',
    创建时间: 1000,
    ...overrides,
  };
}

function buildRecord(name: string, options: { 同行?: boolean; 别名?: string } = {}) {
  return {
    ...创建NPC记录({ 姓名: name, 阶位: 'companion', 别名: options.别名, 初见回合: 0 }),
    同行: options.同行 ?? false,
  };
}

describe('角色记忆注入', () => {
  it('只注入当前在场角色，并标明视角与确信度', () => {
    const event = buildEvent();
    const links = 从事件派生角色记忆(event);
    const result = buildCharacterMemoryInjection({
      records: [buildRecord('三月七', { 同行: true }), buildRecord('丹恒')],
      links,
      events: [event],
      names: [],
      query: '港口',
      currentTurn: 2,
      perCharacterLimit: 3,
      budget: 900,
    });

    expect(result.injection).toContain('## 三月七');
    expect(result.injection).not.toContain('## 丹恒');
    expect(result.injection).toContain('第1回合·亲历·确信');
    expect(result.injection).toContain('不是全知事实');
    expect(result.characters).toEqual([{ name: '三月七', count: 1 }]);
  });

  it('上下文点名到的角色也会被注入，并支持别名命中', () => {
    const event = buildEvent({ 参与人: ['三月'], 亲见: [] });
    const links = 从事件派生角色记忆(event);
    const result = buildCharacterMemoryInjection({
      records: [buildRecord('三月七', { 别名: '三月' })],
      links,
      events: [event],
      names: ['三月'],
      query: '',
      currentTurn: 1,
      perCharacterLimit: 2,
      budget: 900,
    });
    expect(result.injection).toContain('## 三月七');
  });

  it('选择在场角色时优先同行角色，并遵守人数上限', () => {
    const records = [
      buildRecord('三月七', { 同行: true }),
      buildRecord('丹恒', { 同行: true }),
      buildRecord('姬子'),
    ];
    const selected = 选择在场角色(records, [], 1);
    expect(selected.map((record) => record.姓名)).toEqual(['三月七']);
  });

  it('预算不足时不产生半截注入', () => {
    const event = buildEvent();
    const result = buildCharacterMemoryInjection({
      records: [buildRecord('三月七', { 同行: true })],
      links: 从事件派生角色记忆(event),
      events: [event],
      names: [],
      query: '',
      currentTurn: 1,
      perCharacterLimit: 3,
      budget: 10,
    });
    expect(result.injection).toBe('');
    expect(result.characters).toEqual([]);
  });

  it('注入的条目会记入 marks，供下一回合抑制复读', () => {
    const event = buildEvent();
    const result = buildCharacterMemoryInjection({
      records: [buildRecord('三月七', { 同行: true })],
      links: 从事件派生角色记忆(event),
      events: [event],
      names: [],
      query: '',
      currentTurn: 4,
      perCharacterLimit: 3,
      budget: 900,
    });
    expect(result.marks).toEqual([{ 事件ID: event.id, 角色: '三月七', 回合: 4 }]);
  });

  it('把在场角色等待中的约定与未完成事项附在末尾', () => {
    const record = {
      ...buildRecord('三月七', { 同行: true }),
      未完成事项: ['帮三月七找妹妹'],
      约定: [{
        id: 'p1',
        标题: '还书',
        内容: '把借来的书还给三月七',
        当前状态: '等待中' as const,
        回合: 1,
      }],
    };
    const result = buildCharacterMemoryInjection({
      records: [record],
      links: [],
      events: [],
      names: [],
      query: '',
      currentTurn: 5,
      perCharacterLimit: 3,
      budget: 900,
    });
    expect(result.injection).toContain('## 未了之事');
    expect(result.injection).toContain('借来的书');
    expect(result.injection).toContain('找妹妹');
  });

  it('已履行的约定不再进入未了之事', () => {
    const record = {
      ...buildRecord('三月七', { 同行: true }),
      约定: [{
        id: 'p1',
        标题: '还书',
        内容: '把借来的书还给三月七',
        当前状态: '已履行' as const,
        回合: 1,
      }],
    };
    const result = buildCharacterMemoryInjection({
      records: [record],
      links: [],
      events: [],
      names: [],
      query: '',
      currentTurn: 5,
      perCharacterLimit: 3,
      budget: 900,
    });
    expect(result.injection).toBe('');
  });

  it('旧幕只注入与在场角色相关的最近两幕', () => {
    const act = {
      id: 'act_1',
      组号: 1,
      标题: '序章',
      起止回合: [1, 6] as [number, number],
      摘要: '【第1幕·序章】\n- 第1回合：在港口交接货物。\n- 第2回合：一起吃饭。',
      事件数: 6,
      角色: ['三月七'],
      创建时间: 1,
    };
    const result = buildCharacterMemoryInjection({
      records: [buildRecord('三月七', { 同行: true })],
      links: [],
      events: [],
      names: [],
      query: '',
      currentTurn: 7,
      perCharacterLimit: 3,
      budget: 900,
      acts: [act],
    });
    expect(result.injection).toContain('## 旧幕·序章');
    expect(result.injection).toContain('第1回合：在港口交接货物');
  });
});
