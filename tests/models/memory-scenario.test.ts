import { describe, expect, it } from 'vitest';
import { 创建NPC记录 } from '@/models/npc';
import { 从事件派生角色记忆 } from '@/models/characterMemory';
import { 整理幕记忆 } from '@/models/memoryAct';
import { buildCharacterMemoryInjection } from '@/services/memoryCharacterRecall';
import type { 记忆事件 } from '@/models/memoryEvent';

const player = '开拓者';

function makeEvent(partial: Partial<记忆事件> & Pick<记忆事件, 'id' | '回合' | '摘要'>): 记忆事件 {
  return {
    参与人: [],
    亲见: [],
    被告知: [],
    不在场: [],
    背景在场: [],
    公开度: '半公开',
    来源: '正文',
    置信: '高',
    创建时间: 1,
    ...partial,
  };
}

function makeLyra(同行 = true) {
  const record = 创建NPC记录({ 姓名: 'Lyra', 初见回合: 0 });
  record.同行 = 同行;
  return record;
}

describe('记忆场景评测：该想起 / 不该泄露 / 不重复', () => {
  it('只把在场角色的记忆注入给主模型，不泄露不在场角色', () => {
    const e1 = makeEvent({
      id: 'e1',
      回合: 1,
      摘要: 'Lyra 在档案室找到旧地图',
      参与人: ['Lyra', player],
      亲见: ['Lyra'],
      被告知: ['丹恒'],
      背景在场: ['帕姆'],
    });
    const e2 = makeEvent({ id: 'e2', 回合: 2, 摘要: '开拓者独自检查密道', 参与人: [player], 亲见: [player] });
    const links = [e1, e2].flatMap((event) => 从事件派生角色记忆(event, [player]));

    const result = buildCharacterMemoryInjection({
      records: [makeLyra()],
      links,
      events: [e1, e2],
      names: [],
      query: '旧地图',
      currentTurn: 2,
      perCharacterLimit: 3,
      budget: 900,
    });

    expect(result.injection).toContain('Lyra');
    expect(result.injection).toContain('不是全知事实');
    expect(result.injection).not.toContain('丹恒');
    expect(result.injection).not.toContain('帕姆');
  });

  it('被告知只形成听说视角，不会升级成亲历', () => {
    const event = makeEvent({
      id: 'e3',
      回合: 1,
      摘要: '档案室被封锁',
      被告知: ['丹恒'],
      公开度: '公开',
    });
    const links = 从事件派生角色记忆(event, [player]);
    const link = links.find((item) => item.角色 === '丹恒');
    expect(link?.视角).toBe('被告知');
    expect(link?.确信).toBe('听说');
  });

  it('刚注入过的同一条记忆在抑制回合内不重复注入', () => {
    const event = makeEvent({
      id: 'e4',
      回合: 1,
      摘要: 'Lyra 把旧地图交给开拓者',
      参与人: ['Lyra', player],
      亲见: ['Lyra'],
    });
    const links = 从事件派生角色记忆(event, [player]);

    const first = buildCharacterMemoryInjection({
      records: [makeLyra()],
      links,
      events: [event],
      names: [],
      query: '地图',
      currentTurn: 2,
      perCharacterLimit: 3,
      budget: 900,
    });
    expect(first.injection).toContain('Lyra');
    expect(first.marks.length).toBeGreaterThan(0);

    const second = buildCharacterMemoryInjection({
      records: [makeLyra()],
      links,
      events: [event],
      names: [],
      query: '地图',
      currentTurn: 2,
      perCharacterLimit: 3,
      budget: 900,
      history: first.marks,
      suppressTurns: 2,
    });
    expect(second.injection).not.toContain('Lyra');
  });

  it('凑满一幕的事件会被整理成旧幕，链接被收走但旧幕仍可注入', () => {
    const events = Array.from({ length: 8 }, (_, index) =>
      makeEvent({
        id: `a${index + 1}`,
        回合: index + 1,
        摘要: `第${index + 1}回合 Lyra 推进线索`,
        参与人: ['Lyra', player],
        亲见: ['Lyra'],
      }),
    );
    const links = events.flatMap((event) => 从事件派生角色记忆(event, [player]));

    const { act, remainingLinks } = 整理幕记忆({
      events,
      links,
      组号: 1,
      标题: '序幕',
      fromTurn: 0,
      currentTurn: 9,
      now: 1,
    });

    expect(act).not.toBeNull();
    expect(act?.事件数).toBe(8);
    expect(act?.摘要).toContain('【第1幕·序幕】');
    expect(remainingLinks).toHaveLength(0);

    const result = buildCharacterMemoryInjection({
      records: [makeLyra()],
      links: remainingLinks,
      events,
      names: [],
      query: '线索',
      currentTurn: 9,
      perCharacterLimit: 3,
      budget: 900,
      acts: act ? [act] : [],
    });
    expect(result.injection).toContain('旧幕');
    expect(result.injection).toContain('序幕');
  });

  it('未了之事进入注入，已履行的约定不进入', () => {
    const record = 创建NPC记录({ 姓名: 'Lyra', 初见回合: 0 });
    record.未完成事项 = ['归还借来的书'];
    record.约定 = [
      { id: 'p1', 标题: '还书', 内容: '借来的书下周还', 当前状态: '等待中', 回合: 1 },
      { id: 'p2', 标题: '旧约', 内容: '已经完成的约定', 当前状态: '已履行', 回合: 1 },
    ];

    const result = buildCharacterMemoryInjection({
      records: [record],
      links: [],
      events: [],
      names: ['Lyra'],
      query: '',
      currentTurn: 3,
      perCharacterLimit: 3,
      budget: 900,
      未了之事启用: true,
      未了之事条数: 5,
    });

    expect(result.injection).toContain('借来的书');
    expect(result.injection).not.toContain('已经完成的约定');
  });
});
