import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { 归一化剧情编织系列, 归一化剧情编织系统 } from '@/models/storyWeaving';
import { buildPersistedStoryWeavingSystem, hydratePersistedStoryWeavingSystem } from '@/data/storyWeavingPreset';

function 载入世界书系统() {
  const raw = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/story-weaving-canon/wb_main_herta.json'), 'utf8'));
  const series = 归一化剧情编织系列(raw);
  return {
    series,
    system: 归一化剧情编织系统({
      系列列表: [series],
      当前系列ID: series.id,
      当前进度: undefined,
    }),
  };
}

describe('世界书剧情持久化投影', () => {
  it('canon 分段只落运行时字段，存档不会随事件数膨胀', () => {
    const { system } = 载入世界书系统();
    const persisted = buildPersistedStoryWeavingSystem(system);
    const bytes = JSON.stringify(persisted).length;
    // 真实章节正文保留在内置资源；存档只应剩 id/组号/状态等小字段。
    expect(bytes).toBeLessThan(60_000);
    const first = persisted.系列列表[0]?.分段列表[0] as unknown as Record<string, unknown>;
    expect(first?.原文内容).toBeUndefined();
    expect(first?.本段概括).toBeUndefined();
    expect(typeof first?.运行状态).toBe('string');
  });

  it('回载时从内置资源补回正文、事件和档案', () => {
    const { series, system } = 载入世界书系统();
    const persisted = buildPersistedStoryWeavingSystem(system);
    const hydrated = hydratePersistedStoryWeavingSystem(persisted, { ...system, 系列列表: [series] });
    const restored = hydrated.系列列表[0]?.分段列表[0];
    expect(restored?.原文内容.length).toBeGreaterThan(500);
    expect(restored?.本段概括).toBeTruthy();
    expect(restored?.关键事件.length).toBeGreaterThan(0);
  });

  it('旧平铺存档结构不会盖掉新事件树', () => {
    const { series, system } = 载入世界书系统();
    const oldSaved = {
      系列列表: [{ ...series, 分段列表: series.分段列表.slice(0, 1) }],
      当前系列ID: series.id,
      当前进度: undefined,
    } as unknown as Parameters<typeof hydratePersistedStoryWeavingSystem>[0];
    const hydrated = hydratePersistedStoryWeavingSystem(oldSaved, { ...system, 系列列表: [series] });
    expect(hydrated.系列列表[0]?.分段列表.length).toBe(series.分段列表.length);
    expect(hydrated.系列列表[0]?.分段列表.length).toBeGreaterThan(1);
  });

  it('丢失 persistenceVersion 的投影残体也会补回章节与正文', () => {
    const { series, system } = 载入世界书系统();
    const projected = {
      系列列表: [{
        ...series,
        分段列表: series.分段列表.map((segment) => ({
          id: segment.id,
          组号: segment.组号,
          启用注入: segment.启用注入,
          处理状态: segment.处理状态,
          运行状态: segment.运行状态,
          updatedAt: segment.updatedAt,
        })),
      }],
      当前系列ID: series.id,
      当前进度: undefined,
    } as unknown as Parameters<typeof hydratePersistedStoryWeavingSystem>[0];
    const hydrated = hydratePersistedStoryWeavingSystem(projected, { ...system, 系列列表: [series] });
    const restored = hydrated.系列列表[0]?.分段列表[0];
    expect(restored?.章节范围).toBeTruthy();
    expect(restored?.起始章序号).toBeGreaterThan(0);
    expect(restored?.原文内容.length).toBeGreaterThan(500);
  });

  it('手动保存的分段会完整落库，不会被运行时投影吃掉', () => {
    const { series, system } = 载入世界书系统();
    const edited = {
      ...system,
      系列列表: [{
        ...series,
        分段列表: series.分段列表.map((segment, index) => index === 0
          ? { ...segment, 本段概括: '手动修改后的概括', 本地修改: true, updatedAt: Date.now() }
          : segment),
      }],
    };
    const persisted = buildPersistedStoryWeavingSystem(edited as typeof system);
    const hydrated = hydratePersistedStoryWeavingSystem(persisted, { ...system, 系列列表: [series] });
    expect(hydrated.系列列表[0]?.分段列表[0]?.本段概括).toBe('手动修改后的概括');
    expect(hydrated.系列列表[0]?.分段列表[0]?.原文内容.length).toBeGreaterThan(500);
  });
});
