import { describe, expect, it } from 'vitest';
import {
  冲印角色记忆,
  从事件派生角色记忆,
  剪裁角色记忆,
  判断角色记忆清晰度,
  归一化记忆注入记录,
  归一化角色记忆,
  选择角色记忆,
  计算角色记忆重要度,
  type 角色记忆链接,
} from '@/models/characterMemory';
import { 创建空记忆系统, 归一化记忆系统 } from '@/models/memory';
import type { 记忆事件 } from '@/models/memoryEvent';

function buildEvent(overrides: Partial<记忆事件> = {}): 记忆事件 {
  return {
    id: 'evt_1_1000',
    回合: 1,
    时间: '新历 1 日 09:00',
    地点: '港口',
    摘要: '玩家与 Lyra 在港口交接货物。',
    参与人: ['玩家', 'Lyra'],
    亲见: ['Lyra'],
    被告知: [],
    不在场: ['远方的商人'],
    背景在场: [],
    公开度: '半公开',
    来源: '正文',
    置信: '高',
    创建时间: 1000,
    ...overrides,
  };
}

describe('角色记忆派生', () => {
  it('按知情映射派生亲历/目击/被告知/背景四种视角', () => {
    const event = buildEvent({
      参与人: ['Lyra'],
      亲见: ['店主'],
      被告知: ['丹恒'],
      背景在场: ['帕姆'],
      不在场: ['路人'],
    });
    const links = 从事件派生角色记忆(event, ['玩家']);
    const byRole = new Map(links.map((link) => [link.角色, link]));

    expect(byRole.get('Lyra')).toMatchObject({ 视角: '亲历', 确信: '确信' });
    expect(byRole.get('店主')).toMatchObject({ 视角: '目击', 确信: '确信' });
    expect(byRole.get('丹恒')).toMatchObject({ 视角: '被告知', 确信: '听说' });
    expect(byRole.get('帕姆')).toMatchObject({ 视角: '背景', 确信: '模糊' });
    expect(byRole.has('玩家')).toBe(false);
    expect(byRole.has('路人')).toBe(false);
  });

  it('同一角色同时亲历与亲见时取更高视角', () => {
    const event = buildEvent({ 参与人: ['Lyra'], 亲见: ['Lyra'] });
    const links = 从事件派生角色记忆(event);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ 角色: 'Lyra', 视角: '亲历' });
  });

  it('从摘要里推断情绪与意义标签', () => {
    const event = buildEvent({ 摘要: 'Lyra 与玩家激烈争吵，最后愤怒地摔门离开。' });
    const [link] = 从事件派生角色记忆(event);
    expect(link.意义).toContain('冲突');
    expect(link.情绪).toBe('愤怒');
  });
});

describe('角色记忆权重与检索', () => {
  it('冲突事件比日常事件更重要，新事件比旧事件更重要', () => {
    const daily = buildEvent({ 摘要: 'Lyra 在港口吃了早饭。' });
    const conflict = buildEvent({ id: 'evt_2', 摘要: 'Lyra 与玩家在港口爆发冲突。' });
    const [dailyLink] = 从事件派生角色记忆(daily);
    const [conflictLink] = 从事件派生角色记忆(conflict);

    const dailyScore = 计算角色记忆重要度(dailyLink, daily, 1);
    const conflictScore = 计算角色记忆重要度(conflictLink, conflict, 1);
    expect(conflictScore).toBeGreaterThan(dailyScore);

    const oldScore = 计算角色记忆重要度(dailyLink, { ...daily, 回合: 1 }, 200);
    const newScore = 计算角色记忆重要度(dailyLink, { ...daily, 回合: 200 }, 200);
    expect(newScore).toBeGreaterThan(oldScore);
  });

  it('按角色筛选，并按与当前输入的文本相关度排序', () => {
    const eventA = buildEvent({ id: 'evt_a', 回合: 2, 摘要: '在市场买菜。' });
    const eventB = buildEvent({ id: 'evt_b', 回合: 6, 摘要: '在港口发生争吵。' });
    const links = [
      ...从事件派生角色记忆(eventA).map((link) => ({ ...link, 角色: 'Lyra' })),
      ...从事件派生角色记忆(eventB).map((link) => ({ ...link, 角色: 'Lyra' })),
      ...从事件派生角色记忆(eventB).map((link) => ({ ...link, 角色: '丹恒' })),
    ];

    const hits = 选择角色记忆({
      links,
      events: [eventA, eventB],
      role: 'Lyra',
      query: '港口',
      currentTurn: 6,
      limit: 2,
    });

    expect(hits).toHaveLength(2);
    expect(hits[0].event.id).toBe('evt_b');
    expect(hits.every((hit) => hit.link.角色 === 'Lyra')).toBe(true);
  });

  it('支持别名数组检索', () => {
    const event = buildEvent({ 摘要: '三月和玩家一起整理资料。' });
    const links = 从事件派生角色记忆(event, ['玩家']).map((link) => ({ ...link, 角色: '三月' }));
    const hits = 选择角色记忆({ links, events: [event], role: ['三月七', '三月'], query: '', currentTurn: 1, limit: 3 });
    expect(hits).toHaveLength(1);
  });
});

describe('清晰度与冲印', () => {
  it('按重要度分成细节/画面/标签/影子四档', () => {
    const detailed = buildEvent({ 摘要: 'Lyra 与玩家约定，若失败就会失去一切。', 参与人: ['Lyra'] });
    const [detailedLink] = 从事件派生角色记忆(detailed, ['玩家']);
    expect(判断角色记忆清晰度(detailedLink, detailed, 1)).toBe('细节');

    const vivid = buildEvent({ 摘要: 'Lyra 在港口交接货物。', 参与人: ['Lyra'] });
    const [vividLink] = 从事件派生角色记忆(vivid, ['玩家']);
    expect(判断角色记忆清晰度(vividLink, vivid, 1)).toBe('画面');

    const tagged = buildEvent({ 摘要: '丹恒得知了秘密。', 参与人: [], 亲见: [], 被告知: ['丹恒'] });
    const [taggedLink] = 从事件派生角色记忆(tagged, ['玩家']);
    expect(判断角色记忆清晰度(taggedLink, tagged, 1)).toBe('标签');

    const shadow = buildEvent({ 摘要: '帕姆在港口吃了早饭。', 参与人: [], 亲见: [], 背景在场: ['帕姆'] });
    const [shadowLink] = 从事件派生角色记忆(shadow, ['玩家']);
    expect(判断角色记忆清晰度(shadowLink, shadow, 200)).toBe('影子');
  });

  it('细节档带正文锚点，标签与影子档只保留印象', () => {
    const event = buildEvent({ 摘要: 'Lyra 与玩家约定，若失败就会失去一切。', 参与人: ['Lyra'], 正文锚点: '她把钥匙放在桌上。' });
    const [link] = 从事件派生角色记忆(event, ['玩家']);
    const detail = 冲印角色记忆(link, event, '细节');
    expect(detail).toContain('·细节】');
    expect(detail).toContain('细节：她把钥匙放在桌上。');

    const tag = 冲印角色记忆(link, event, '标签');
    expect(tag).toContain('只剩大致印象');
    expect(tag).not.toContain('钥匙');

    const shadow = 冲印角色记忆(link, event, '影子');
    expect(shadow).toContain('细节已经模糊');
  });
});

describe('最近提及抑制', () => {
  it('同角色同事件在抑制回合内不重复注入', () => {
    const event = buildEvent({ 参与人: ['Lyra'] });
    const links = 从事件派生角色记忆(event, ['玩家']);
    const history = [{ 事件ID: event.id, 角色: 'Lyra', 回合: 9 }];
    const base = { links, events: [event], role: 'Lyra', query: '', limit: 3, history, suppressTurns: 2 };

    expect(选择角色记忆({ ...base, currentTurn: 10 })).toHaveLength(0);
    expect(选择角色记忆({ ...base, currentTurn: 12 })).toHaveLength(1);
  });

  it('归一化注入历史时同一事件同一角色只保留最新回合', () => {
    const issues: string[] = [];
    const result = 归一化记忆注入记录([
      { 事件ID: 'e1', 角色: 'Lyra', 回合: 3 },
      { 事件ID: 'e1', 角色: 'Lyra', 回合: 5 },
      { 事件ID: '', 角色: 'Lyra', 回合: 6 },
    ], issues);
    expect(result).toEqual([{ 事件ID: 'e1', 角色: 'Lyra', 回合: 5 }]);
    expect(issues.join('')).toContain('非法项');
  });
});

describe('角色记忆维护', () => {
  it('剪裁掉指向已不存在事件的链接', () => {
    const alive = buildEvent();
    const dead = buildEvent({ id: 'evt_dead' });
    const links = [...从事件派生角色记忆(alive, ['玩家']), ...从事件派生角色记忆(dead, ['玩家'])];
    const kept = 剪裁角色记忆(links, [alive]);
    expect(kept).toHaveLength(1);
    expect(kept[0].事件ID).toBe(alive.id);
  });

  it('归一化时清除非法项与重复 id', () => {
    const issues: string[] = [];
    const valid = 从事件派生角色记忆(buildEvent())[0];
    const input = [valid, { ...valid }, { id: '', 事件ID: 'x', 角色: 'Lyra' }, 'bad'];
    const result = 归一化角色记忆(input, issues);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(valid.id);
    expect(issues.join('')).toContain('非法项');
  });

  it('记忆系统往返保留角色记忆并给旧档补空数组', () => {
    const link: 角色记忆链接 = 从事件派生角色记忆(buildEvent(), ['玩家'])[0];
    const { value } = 归一化记忆系统({ 角色记忆: [link] });
    expect(value.角色记忆).toHaveLength(1);
    expect(value.角色记忆?.[0]).toMatchObject({ 角色: 'Lyra', 视角: '亲历' });

    const empty = 创建空记忆系统();
    expect(empty.角色记忆).toEqual([]);
    const oldSave = 归一化记忆系统({ 即时记忆: ['a'] }).value;
    expect(oldSave.角色记忆).toEqual([]);
  });
});
