import { describe, expect, it } from 'vitest';
import { 创建NPC记录 } from '@/models/npc';
import {
  创建朋友圈动态,
  封顶朋友圈动态,
  归一化朋友圈动态,
  选取朋友圈作者,
  收集朋友圈知情角色,
  构建朋友圈记忆事件,
  计算朋友圈下次回合,
  归一化朋友圈生成结果,
  归一化朋友圈图片,
  构建朋友圈配图提示词,
} from '@/models/moments';

function npc(name: string, extra: Partial<Parameters<typeof 创建NPC记录>[0]> = {}) {
  return 创建NPC记录({ 姓名: name, 初见回合: 0, ...extra });
}

describe('moments model', () => {
  it('朋友圈间隔按随机数落在闭区间', () => {
    expect(计算朋友圈下次回合(10, 3, 5, () => 0)).toBe(13);
    expect(计算朋友圈下次回合(10, 3, 5, () => 0.999)).toBe(15);
    expect(计算朋友圈下次回合(10, 3, 5, () => 1)).toBe(15);
  });

  it('只从可用、不在场、最近没发过的通讯录角色里抽作者', () => {
    const 三月七 = npc('三月七');
    const 丹恒 = npc('丹恒');
    const 姬子 = npc('姬子');
    const 瓦尔特 = npc('瓦尔特');
    const authors = 选取朋友圈作者({
      contacts: [
        { name: '三月七', npcId: 三月七.id, available: true },
        { name: '丹恒', npcId: 丹恒.id, available: true },
        { name: '姬子', npcId: 姬子.id, available: false },
        { name: '瓦尔特', npcId: 瓦尔特.id, available: true },
      ],
      npcs: [三月七, 丹恒, 姬子, 瓦尔特],
      presentNames: ['三月七'],
      recentAuthors: ['丹恒'],
      min: 2,
      max: 2,
      random: () => 0,
    });
    expect(authors.map((item) => item.姓名)).toEqual(['瓦尔特']);
  });

  it('关系网知情同时覆盖正向与反向关系', () => {
    const 三月七 = npc('三月七', {
      关系脉络: [{ id: 'e1', 目标姓名: '丹恒', 关系: '列车组伙伴' }],
    });
    const 丹恒 = npc('丹恒');
    const 姬子 = npc('姬子', {
      关系脉络: [{ id: 'e2', 目标姓名: '三月七', 关系: '列车组后辈' }],
    });
    const 路人 = npc('路人');
    const audience = 收集朋友圈知情角色(三月七, [三月七, 丹恒, 姬子, 路人]);
    expect(audience).toEqual(expect.arrayContaining(['丹恒', '姬子']));
    expect(audience).not.toContain('路人');
  });

  it('生成结果只接受本批作者，重复作者只留第一条', () => {
    const 三月七 = npc('三月七');
    const 丹恒 = npc('丹恒');
    const result = 归一化朋友圈生成结果(
      [
        { 作者: '三月七', 内容: '今天拍到了一张很好看的照片。' },
        { 作者: '三月七', 内容: '重复的。' },
        { 作者: '路人', 内容: '不该出现的人。' },
        { 作者: '丹恒', 内容: '列车的维护记录又该更新了。', 配图: '冷色调的车厢' },
      ],
      [三月七, 丹恒],
    );
    expect(result).toHaveLength(2);
    expect(result[0].作者).toBe('三月七');
    expect(result[0].内容).toContain('照片');
    expect(result[1]).toMatchObject({ 作者: '丹恒', 配图: '冷色调的车厢' });
  });

  it('动态归一化去重、封顶并保留配图/知情角色', () => {
    const list = 归一化朋友圈动态([
      { id: 'm1', 作者姓名: '三月七', 内容: '一', 回合: 1, 知情角色: ['丹恒', '丹恒'] },
      { id: 'm1', 作者姓名: '三月七', 内容: '重复', 回合: 1 },
      { id: 'm2', 作者姓名: '丹恒', 内容: '二', 回合: 2, 配图: '书页' },
      { id: '', 作者姓名: '姬子', 内容: '三' },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0].知情角色).toEqual(['丹恒']);
    expect(封顶朋友圈动态(list, 1)).toHaveLength(1);
  });

  it('动态转记忆事件时把知情角色写进被告知', () => {
    const moment = 创建朋友圈动态({
      author: npc('三月七'),
      content: '在车厢窗边晒了一下午太阳。',
      turn: 12,
      audience: ['丹恒', '姬子'],
      now: 1700000000000,
    });
    const event = 构建朋友圈记忆事件({ moment });
    expect(event.回合).toBe(12);
    expect(event.摘要).toContain('朋友圈');
    expect(event.被告知).toEqual(['丹恒', '姬子']);
    expect(event.公开度).toBe('半公开');
    expect(event.正文锚点).toContain('太阳');
  });

  it('配图只接受压缩后的 data URL，拒绝远程地址和超限内容', () => {
    expect(归一化朋友圈图片({ 数据地址: 'https://example.com/a.png', 宽度: 10, 高度: 10 })).toBeUndefined();
    expect(归一化朋友圈图片({ 数据地址: `data:image/jpeg;base64,${'a'.repeat(2_000_000)}`, 宽度: 1, 高度: 1 })).toBeUndefined();
    expect(归一化朋友圈图片({ 数据地址: 'data:image/jpeg;base64,abc', 宽度: 720, 高度: 480 })).toEqual({
      数据地址: 'data:image/jpeg;base64,abc',
      宽度: 720,
      高度: 480,
    });
  });

  it('创建与归一化动态时保留配图，旧档没有图片也能读', () => {
    const moment = 创建朋友圈动态({
      author: npc('三月七'),
      content: '今天的光很好。',
      turn: 3,
      audience: [],
      配图: '窗边的咖啡',
      图片: { 数据地址: 'data:image/jpeg;base64,abc', 宽度: 720, 高度: 480 },
    });
    expect(moment.图片?.宽度).toBe(720);
    const list = 归一化朋友圈动态([moment, { id: 'old', 作者姓名: '丹恒', 内容: '旧动态' }]);
    expect(list[0].图片?.数据地址).toContain('data:image/');
    expect(list[1].图片).toBeUndefined();
  });

  it('朋友圈配图提示词强调生活照并排除文字水印', () => {
    const prompt = 构建朋友圈配图提示词('三月七', '窗边的咖啡和摊开的书');
    expect(prompt).toContain('三月七');
    expect(prompt).toContain('窗边的咖啡');
    expect(prompt).toContain('生活照');
    expect(prompt).toContain('不出现文字');
  });
});
