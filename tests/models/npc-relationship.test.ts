import { describe, expect, it } from 'vitest';
import { 创建NPC记录 } from '@/models/npc';
import {
  合并NPC关系脉络,
  归一化NPC关系脉络,
  提取资料库关系网,
  解析资料库关系段,
  补种NPC关系网,
  更新NPC关系脉络,
} from '@/models/npcRelationship';
import type { 智库条目 } from '@/models/zhiku';

function 条目(标题: string, 关系边界: string): 智库条目 {
  return {
    标题,
    分类: 'character',
    关键词: [],
    内容: '',
    关系边界,
    注入内容: { 演绎红线: '' },
  } as unknown as 智库条目;
}

const 三月七档案 = `关系边界：列车组成员。
与他人关系（部分）：
星：并肩作战的伙伴，会一起吐槽。
丹恒：冷静判断上互相补位。
姬子、瓦尔特：值得信赖的前辈。
开拓者：不可以把玩家当成 NPC。`;

describe('npc relationship seed', () => {
  it('解析关系段时拆分并列目标并过滤玩家称呼', () => {
    const edges = 解析资料库关系段(三月七档案, '三月七');
    expect(edges.map((edge) => edge.目标姓名)).toEqual(['丹恒', '姬子', '瓦尔特']);
    expect(edges.find((edge) => edge.目标姓名 === '丹恒')?.关系).toBe('冷静判断上互相补位');
    expect(edges.some((edge) => edge.目标姓名 === '开拓者')).toBe(false);
  });

  it('解析“与”并列的两个目标', () => {
    const edges = 解析资料库关系段(
      '与他人关系（部分）：\n云璃与彦卿：仙舟习剑的两位小师父。',
      '三月七',
    );
    expect(edges.map((edge) => edge.目标姓名)).toEqual(['云璃', '彦卿']);
  });

  it('从资料库条目提取角色关系图，跳过玩家本人', () => {
    const graph = 提取资料库关系网([
      条目('三月七', 三月七档案),
      条目('星', `与他人关系（部分）：\n三月七：一起旅行的伙伴。`),
    ]);
    expect(graph.has('三月七')).toBe(true);
    expect(graph.has('星')).toBe(false);
    expect(graph.get('三月七')?.map((edge) => edge.目标姓名)).toEqual(['丹恒', '姬子', '瓦尔特']);
  });

  it('补种到 NPC 记录，并把目标名解析成目标 NPCID', () => {
    const records = [
      创建NPC记录({ 姓名: '三月七', 初见回合: 0, 阶位: 'companion', 原著角色: true }),
      创建NPC记录({ 姓名: '丹恒', 初见回合: 0, 阶位: 'companion', 原著角色: true }),
    ];
    const seeded = 补种NPC关系网(records, [条目('三月七', 三月七档案)]);
    expect(seeded).not.toBe(records);
    const march = seeded.find((record) => record.姓名 === '三月七');
    expect(march?.关系网已补种).toBe(true);
    expect(march?.关系脉络?.map((edge) => edge.目标姓名)).toEqual(['丹恒', '姬子', '瓦尔特']);
    expect(march?.关系脉络?.find((edge) => edge.目标姓名 === '丹恒')?.目标NPCID).toBe(
      seeded.find((record) => record.姓名 === '丹恒')?.id,
    );
  });

  it('force 补种不会覆盖玩家手写的关系', () => {
    const record = 创建NPC记录({ 姓名: '三月七', 初见回合: 0, 阶位: 'companion' });
    record.关系脉络 = [{
      id: 'player-edge',
      目标姓名: '星',
      关系: '生死之交',
      说明: '玩家亲手写的',
      来源: '玩家',
    }];
    const seeded = 补种NPC关系网([record], [条目('三月七', 三月七档案)], { force: true });
    const edge = seeded[0]?.关系脉络?.find((item) => item.目标姓名 === '星');
    expect(edge?.关系).toBe('生死之交');
    expect(edge?.来源).toBe('玩家');
  });

  it('归一化会去掉自身关系并按目标去重', () => {
    const normalized = 归一化NPC关系脉络([
      { 目标姓名: '丹恒', 关系: '旧识', 来源: '玩家' },
      { 目标姓名: '丹恒', 关系: '重复项' },
      { 目标姓名: '三月七', 关系: '自己' },
      { 目标姓名: '', 关系: '空目标' },
    ], ['三月七']);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.目标姓名).toBe('丹恒');
    expect(normalized[0]?.来源).toBe('玩家');
  });

  it('合并时保留玩家边，资料库只补缺', () => {
    const merged = 合并NPC关系脉络(
      [{ id: 'a', 目标姓名: '丹恒', 关系: '旧识', 来源: '玩家' }],
      [
        { id: 'b', 目标姓名: '丹恒', 关系: '资料库描述', 说明: '更长的说明', 来源: '资料库' },
        { id: 'c', 目标姓名: '姬子', 关系: '前辈', 来源: '资料库' },
      ],
    );
    expect(merged.find((edge) => edge.目标姓名 === '丹恒')?.关系).toBe('旧识');
    expect(merged.some((edge) => edge.目标姓名 === '姬子')).toBe(true);
  });

  it('资料库为空时保持原数组引用', () => {
    const records = [创建NPC记录({ 姓名: '三月七', 初见回合: 0 })];
    expect(补种NPC关系网(records, [])).toBe(records);
  });

  it('关系变化会记录阶段与变更历史，并保留旧历史', () => {
    const first = 更新NPC关系脉络([], {
      目标姓名: '星',
      关系: '同一列车的伙伴',
      阶段: '同行',
      回合: 3,
      原因: '星上车',
      来源: 'AI',
    });
    expect(first[0]?.阶段).toBe('同行');
    expect(first[0]?.变更记录?.[0]?.到).toBe('同一列车的伙伴');

    const second = 更新NPC关系脉络(first, {
      目标姓名: '星',
      关系: '闺蜜',
      阶段: '挚友',
      回合: 8,
      原因: '关系熟络',
      来源: 'AI',
    });
    const edge = second[0];
    expect(edge.关系).toBe('闺蜜');
    expect(edge.阶段).toBe('挚友');
    expect(edge.变更记录).toHaveLength(2);
    expect(edge.变更记录?.[1]).toMatchObject({ 回合: 8, 从: '同一列车的伙伴', 到: '闺蜜', 原因: '关系熟络' });
  });

  it('归一化保留阶段与变更记录', () => {
    const normalized = 归一化NPC关系脉络([{
      目标姓名: '星',
      关系: '同一后宫的姐妹',
      阶段: '亲密',
      最近更新回合: 12,
      变更记录: [{ 回合: 12, 从: '闺蜜', 到: '同一后宫的姐妹', 原因: '达成共识' }],
      来源: 'AI',
    }], ['三月七']);
    expect(normalized[0]?.阶段).toBe('亲密');
    expect(normalized[0]?.变更记录?.[0]?.到).toBe('同一后宫的姐妹');
  });
});
