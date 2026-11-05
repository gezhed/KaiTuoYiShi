import { describe, expect, it } from 'vitest';
import { 创建NPC记录 } from '@/models/npc';
import {
  提取前史关系种子,
  合并前史关系种子,
  收集前史关系文本,
} from '@/models/relationshipSeed';

describe('前史关系种子', () => {
  it('从旅人背景里识别原著角色与青梅竹马关系', () => {
    const seeds = 提取前史关系种子('我和三月七是从小一起长大的青梅竹马，后来她欠我一个人情。');

    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toMatchObject({
      姓名: '三月七',
      关系描述: '青梅竹马',
      好感度: 50,
      亲密关系: false,
      原著角色: true,
    });
    expect(seeds[0].证据).toContain('青梅竹马');
  });

  it('否定句和“只是听说”不会生成种子', () => {
    expect(提取前史关系种子('我并不认识三月七，只是听说过她。')).toEqual([]);
  });

  it('识别原创角色与亲密关系', () => {
    const seeds = 提取前史关系种子('我的妹妹叫小雨，我们关系很好。');

    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toMatchObject({
      姓名: '小雨',
      关系描述: '熟识',
      好感度: 20,
      原著角色: false,
    });
  });

  it('敌对关系优先于搭档描述', () => {
    const seeds = 提取前史关系种子('我和丹恒曾经是搭档，后来反目成仇。');

    expect(seeds[0]).toMatchObject({
      姓名: '丹恒',
      关系描述: '敌对',
      好感度: -31,
      原著角色: true,
    });
  });

  it('同一角色多句提到时只保留一条种子', () => {
    const seeds = 提取前史关系种子('我和三月七是旧识。三月七是我的青梅竹马。');

    expect(seeds).toHaveLength(1);
    expect(seeds[0].姓名).toBe('三月七');
    expect(seeds[0].好感度).toBe(50);
    expect(seeds[0].证据).toContain('旧识');
    expect(seeds[0].证据).toContain('青梅竹马');
  });

  it('组合旅人背景与开局设定文本', () => {
    expect(收集前史关系文本(' 背景 ', '', undefined, '开局')).toBe('背景\n开局');
  });
});

describe('前史关系种子合并', () => {
  it('新局里没有互动过的记录接受种子好感度', () => {
    const existing = 创建NPC记录({ 姓名: '三月七', 初见回合: 0 });
    const merged = 合并前史关系种子([existing], 提取前史关系种子('我和三月七是青梅竹马。'));

    const record = merged.find((npc) => npc.姓名 === '三月七');
    expect(merged).toHaveLength(1);
    expect(record?.好感度).toBe(50);
    expect(record?.同行记忆?.some((memory) => memory.摘要.includes('前史'))).toBe(true);
    expect(record?.共同经历?.some((item) => item.includes('青梅竹马'))).toBe(true);
  });

  it('已经玩过的记录不被种子打回初始好感', () => {
    const existing = {
      ...创建NPC记录({ 姓名: '三月七', 初见回合: 3 }),
      好感度: 10,
      最近回合: 8,
    };
    const merged = 合并前史关系种子([existing], 提取前史关系种子('我和三月七是恋人。'));

    const record = merged.find((npc) => npc.姓名 === '三月七');
    expect(record?.好感度).toBe(10);
    expect(record?.亲密关系).toBe(true);
    expect(record?.同行记忆?.some((memory) => memory.摘要.includes('前史'))).toBe(true);
  });

  it('原创角色默认落在路人阶位，亲密关系才升为伙伴', () => {
    const acquaintance = 合并前史关系种子([], 提取前史关系种子('我的邻居叫小雨，我们关系很好。'));
    expect(acquaintance[0].阶位).toBe('extra');

    const intimate = 合并前史关系种子([], 提取前史关系种子('我的恋人叫小雨。'));
    expect(intimate[0].阶位).toBe('companion');
    expect(intimate[0].亲密关系).toBe(true);
  });
});
