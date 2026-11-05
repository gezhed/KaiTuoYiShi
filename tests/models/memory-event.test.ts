import { describe, expect, it } from 'vitest';
import { 创建空记忆系统, 归一化记忆系统 } from '@/models/memory';
import {
  构建记忆事件FromReply,
  封顶记忆事件,
  归一化记忆事件,
  提取知情映射文本,
  解析知情映射,
  type 记忆事件,
} from '@/models/memoryEvent';

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

describe('知情映射解析', () => {
  it('解析一行完整的知情映射', () => {
    const mapping = 解析知情映射(
      'Step14: 最终审片\n【知情映射】在场：玩家、Lyra；背景在场：店主；亲见：Lyra；被告知：玩家；不在场：远方的商人；公开度：半公开',
    );

    expect(mapping).not.toBeNull();
    expect(mapping).toMatchObject({
      在场: ['玩家', 'Lyra'],
      背景在场: ['店主'],
      亲见: ['Lyra'],
      被告知: ['玩家'],
      不在场: ['远方的商人'],
      公开度: '半公开',
    });
  });

  it('支持被模型换行拆开的映射', () => {
    const thinking = [
      '【知情映射】在场：玩家、Lyra',
      '亲见：Lyra',
      '不在场：远方的商人',
      '公开度：私密',
    ].join('\n');

    expect(解析知情映射(thinking)).toMatchObject({
      在场: ['玩家', 'Lyra'],
      亲见: ['Lyra'],
      不在场: ['远方的商人'],
      公开度: '私密',
    });
  });

  it('不在场与在场冲突时以在场为准', () => {
    const mapping = 解析知情映射('【知情映射】在场：玩家；不在场：玩家、路人；公开度：公开');

    expect(mapping).not.toBeNull();
    expect(mapping?.在场).toStrictEqual(['玩家']);
    expect(mapping?.不在场).toStrictEqual(['路人']);
  });

  it('没有映射、只有标题、只有无名字段时返回 null 或空名单', () => {
    expect(解析知情映射('Step14 结束')).toBeNull();
    expect(提取知情映射文本('【知情映射】')).toBeNull();
    expect(解析知情映射('【知情映射】在场的只有 Lyra')).toBeNull();

    const empty = 解析知情映射('【知情映射】在场：无；亲见：无；公开度：公开');
    expect(empty).not.toBeNull();
    expect(empty?.在场).toStrictEqual([]);
    expect(empty?.公开度).toBe('公开');
  });
});

describe('构建记忆事件', () => {
  it('优先用小結做摘要，并保留正文锚点', () => {
    const event = 构建记忆事件FromReply({
      turn: 3,
      thinking: '【知情映射】在场：玩家、Lyra；亲见：Lyra；公开度：公开',
      body: '正文内容'.repeat(80),
      summary: '玩家把货箱交给 Lyra。',
      worldTime: '新历 1 日 09:00',
      location: '港口',
      now: 1234,
    });

    expect(event).not.toBeNull();
    expect(event?.摘要).toBe('玩家把货箱交给 Lyra。');
    expect(event?.回合).toBe(3);
    expect(event?.正文锚点?.length).toBeLessThanOrEqual(401);
    expect(event?.来源).toBe('正文');
    expect(event?.置信).toBe('高');
  });

  it('小結为空时退回正文开头；完全无映射则不建事件', () => {
    const event = 构建记忆事件FromReply({
      turn: 1,
      thinking: '【知情映射】在场：玩家；公开度：私密',
      body: '  海风很大。  ',
      summary: '   ',
      now: 1,
    });
    expect(event?.摘要).toBe('海风很大。');

    expect(构建记忆事件FromReply({
      turn: 1,
      thinking: '没有映射',
      body: '正文',
      summary: '小結',
      now: 1,
    })).toBeNull();
  });
});

describe('事件归一化与封顶', () => {
  it('清除非法项、去重 id、保留合法事件', () => {
    const issues: string[] = [];
    const result = 归一化记忆事件([
      buildEvent(),
      { id: 'evt_1_1000', 摘要: '重复 id' },
      { id: '', 摘要: '空 id' },
      { id: 'evt_2', 摘要: '缺回合', 参与人: '不是数组' },
      '不是对象',
    ], issues);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('evt_1_1000');
    expect(result[1].参与人).toStrictEqual([]);
    expect(issues.join('')).toContain('非法项');
  });

  it('最多保留 500 条，按最旧丢弃', () => {
    const events = Array.from({ length: 510 }, (_, index) => buildEvent({ id: `evt_${index}`, 回合: index }));
    const capped = 封顶记忆事件(events);
    expect(capped).toHaveLength(500);
    expect(capped[0].id).toBe('evt_10');
    expect(capped[499].id).toBe('evt_509');
  });

  it('记忆系统归一化保留事件且不产生 issue', () => {
    const memory = { ...创建空记忆系统(), 事件: [buildEvent()] };
    const normalized = 归一化记忆系统(JSON.parse(JSON.stringify(memory)));

    expect(normalized.issues).toStrictEqual([]);
    expect(normalized.value.事件).toHaveLength(1);
    expect(normalized.value.事件?.[0].摘要).toContain('港口');
  });
});
