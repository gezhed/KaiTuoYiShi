import { describe, expect, it } from 'vitest';
import type { 记忆事件 } from '@/models/memoryEvent';
import { 创建默认记忆系统设置 } from '@/models/settings';
import { formatMemoryRecallSection } from '@/hooks/useGame/systemPromptSections';
import {
  buildMemoryEventEmbeddingText,
  buildMemoryRecallInjection,
  selectVectorHits,
} from '@/services/memoryVector/memoryVectorRecall';
import { cosineSimilarity, hashText } from '@/services/memoryVector/vectorMath';

function event(id: string, turn: number, summary: string, extra: Partial<记忆事件> = {}): 记忆事件 {
  return {
    id,
    回合: turn,
    时间: '星历 2157 年 3 月',
    地点: '黑塔空间站',
    摘要: summary,
    参与人: ['开拓者'],
    亲见: ['开拓者'],
    被告知: [],
    不在场: [],
    背景在场: [],
    公开度: '公开',
    来源: '正文',
    置信: '高',
    正文锚点: `${summary}的正文证据`,
    创建时间: 1,
    ...extra,
  };
}

describe('memory vector math', () => {
  it('hashText 稳定且能区分不同文本', () => {
    expect(hashText('三月七')).toBe(hashText('三月七'));
    expect(hashText('三月七')).not.toBe(hashText('丹恒'));
    expect(hashText('')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('cosineSimilarity 处理同向、正交与维度不一致', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([2, 0]))).toBeCloseTo(1);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0, 0]))).toBe(0);
  });
});

describe('memory vector recall', () => {
  const events = [
    event('e1', 1, '和三月七在观景车厢看星星'),
    event('e2', 2, '丹恒在训练场练枪'),
    event('e3', 3, '姬子请喝咖啡'),
  ];

  it('按余弦排序并过滤阈值', () => {
    const vectors = new Map<string, Float32Array>([
      ['e1', new Float32Array([1, 0])],
      ['e2', new Float32Array([0.7, 0.7])],
      ['e3', new Float32Array([0, 1])],
    ]);
    const hits = selectVectorHits(events, vectors, new Float32Array([1, 0]), 2, 0.5);
    expect(hits.map((hit) => hit.event.id)).toEqual(['e1', 'e2']);
    expect(hits[0].score).toBeCloseTo(1);
  });

  it('跳过缺少向量的条目', () => {
    const vectors = new Map<string, Float32Array>([['e2', new Float32Array([1, 0])]]);
    const hits = selectVectorHits(events, vectors, new Float32Array([1, 0]), 3, 0.1);
    expect(hits.map((hit) => hit.event.id)).toEqual(['e2']);
  });

  it('构造事件嵌入文本时包含时间地点与正文证据', () => {
    const text = buildMemoryEventEmbeddingText(events[0]);
    expect(text).toContain('星历 2157 年 3 月');
    expect(text).toContain('黑塔空间站');
    expect(text).toContain('观景车厢');
    expect(text).toContain('正文证据');
  });

  it('注入文本遵守字数预算并保留高分条目', () => {
    const hits = [
      { event: events[0], score: 0.9 },
      { event: events[1], score: 0.8 },
    ];
    const injection = buildMemoryRecallInjection(hits, 160);
    expect(injection).toContain('观景车厢');
    expect(injection.length).toBeLessThanOrEqual(170);
  });

  it('没有命中时不生成注入段', () => {
    expect(buildMemoryRecallInjection([], 500)).toBe('');
    expect(formatMemoryRecallSection('')).toBe('');
    expect(formatMemoryRecallSection('  ')).toBe('');
    expect(formatMemoryRecallSection('- 测试')).toContain('# 记忆｜相关回忆');
  });

  it('默认设置包含本地向量召回参数', () => {
    const settings = 创建默认记忆系统设置();
    expect(settings.向量召回启用).toBe(true);
    expect(settings.向量召回模型).toContain('bge-small-zh');
    expect(settings.向量召回模型源).toContain('hf-mirror');
    expect(settings.向量召回TopK).toBeGreaterThan(0);
    expect(settings.向量召回最低相似度).toBeGreaterThan(0);
    expect(settings.向量召回注入字数).toBeGreaterThan(0);
  });
});
