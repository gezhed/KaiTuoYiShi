import { describe, expect, it } from 'vitest';
import { buildStoryWeavingInjection } from '@/services/storyWeaving';
import { createPromptFixture, createStoryWeavingFixture } from './fixtures';

describe('剧情编织注入', () => {
  it('已历经、当前与前方分段按顺序作为运行时素材交付', () => {
    const { context } = createPromptFixture();
    const prompt = buildStoryWeavingInjection(createStoryWeavingFixture(), context);

    const previous = prompt.indexOf('PREVIOUS_SEGMENT_PAYLOAD');
    const current = prompt.indexOf('CURRENT_SEGMENT_PAYLOAD');
    const next = prompt.indexOf('NEXT_SEGMENT_PAYLOAD');
    expect(previous).toBeGreaterThanOrEqual(0);
    expect(current).toBeGreaterThanOrEqual(0);
    expect(next).toBeGreaterThanOrEqual(0);
    expect(previous).toBeLessThan(current);
    expect(current).toBeLessThan(next);
  });

  it('当前区域与系列区域不一致时撤回注入', () => {
    const { context } = createPromptFixture();
    expect(buildStoryWeavingInjection(createStoryWeavingFixture(), { ...context, currentRegionId: 'jarilo_vi' })).toBe('');
  });

  it('区域一致时保持注入', () => {
    const { context } = createPromptFixture();
    expect(buildStoryWeavingInjection(createStoryWeavingFixture(), { ...context, currentRegionId: 'herta_space_station' }))
      .toContain('CURRENT_SEGMENT_PAYLOAD');
  });

  it('支线等独立剧情只注入当前段，不带入相邻任务', () => {
    const { context } = createPromptFixture();
    const system = createStoryWeavingFixture();
    system.系列列表[0].剧情分类 = '支线';
    const prompt = buildStoryWeavingInjection(system, context);
    expect(prompt).toContain('CURRENT_SEGMENT_PAYLOAD');
    expect(prompt).not.toContain('PREVIOUS_SEGMENT_PAYLOAD');
    expect(prompt).not.toContain('NEXT_SEGMENT_PAYLOAD');
    expect(prompt).not.toContain('# 最近已完成情节一览');
  });
});
