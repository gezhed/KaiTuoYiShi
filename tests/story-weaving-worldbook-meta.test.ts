import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { 归一化剧情编织系列 } from '@/models/storyWeaving';
import { autoAlignCanonStoryProgress, buildStoryAdvanceDeclarationContract, 获取激活剧情系列 } from '@/services/storyProgressService';
import { selectBatchTargets } from '@/components/features/GameSystems/plot/batchDecompose';
import { createStoryWeavingFixture } from './prompts/fixtures';
import type { 剧情编织分段, 剧情编织系列, 剧情编织系统 } from '@/models/storyWeaving';

function segment(index: number, runtime: 剧情编织分段['运行状态'], summary: string, char: string): 剧情编织分段 {
  return {
    id: `seg_${index}`,
    组号: index,
    标题: `第${index}段`,
    章节范围: `第${index}章`,
    章节标题: [`第${index}章`],
    是否开局组: index === 1,
    起始章序号: index,
    结束章序号: index,
    启用注入: true,
    原文内容: `正文${index}`,
    字数: 3,
    原文摘要: summary,
    本段概括: summary,
    时间线起点: '',
    时间线终点: '',
    开局已成立事实: [],
    前段延续事实: [],
    本段结束状态: [],
    给后续参考: [],
    原著硬约束: [],
    可提前铺垫: [],
    登场角色: [char],
    涉及地点: [],
    涉及派系: [],
    角色档案: [],
    势力档案: [],
    地图地点档案: [],
    关键事件: [],
    时间线: [],
    角色推进: [],
    处理状态: '已完成',
    运行状态: runtime,
    updatedAt: 0,
  };
}

function series(): 剧情编织系列 {
  return {
    id: 'worldbook_test',
    标题: '世界书测试',
    作品名: '世界书测试',
    来源类型: 'canon',
    来源智库条目ID: [],
    章节列表: [1, 2, 3].map((index) => ({ id: `chapter_${index}`, 序号: index, 标题: `第${index}章`, 内容: '', 字数: 0 })),
    分段列表: [
      segment(1, '已经历', '前期摘要', '前期角色'),
      segment(2, '当前', '当前摘要', '前期角色'),
      segment(3, '未开始', '后期摘要', '后期角色'),
    ],
    每段章数: 1,
    激活注入: true,
    当前分段组号: 2,
    当前阶段概括: '',
    核心角色摘要: [],
    核心角色: [],
    涉及地点索引: [],
    涉及派系索引: [],
    createdAt: 0,
    updatedAt: 0,
    剧情分类: '主线',
    剧情地区: '翁法罗斯',
    剧情版本: '3.6',
    剧情排序: 10,
    剧情来源: '世界书',
  };
}

function storySystem(): 剧情编织系统 {
  const base = series();
  return {
    系列列表: [base],
    当前系列ID: base.id,
    当前进度: {
      当前系列ID: base.id,
      当前分段ID: 'seg_2',
      当前分段组号: 2,
      推进状态: '推进中',
      已完成摘要: [],
      当前待解问题: [],
      切换说明: [],
      历史归档: [],
      最近判定理由: [],
      updatedAt: 0,
    },
  };
}

describe('世界书剧情元数据与聚合', () => {
  it('归一化保留分类、地区、版本与资料源', () => {
    const normalized = 归一化剧情编织系列(series());
    expect(normalized.剧情分类).toBe('主线');
    expect(normalized.剧情地区).toBe('翁法罗斯');
    expect(normalized.剧情版本).toBe('3.6');
    expect(normalized.剧情排序).toBe(10);
    expect(normalized.剧情来源).toBe('世界书');
  });

  it('聚合只读取当前进度之前的段落，不把后期角色和摘要提前算进来', () => {
    const normalized = 归一化剧情编织系列(series());
    expect(normalized.当前阶段概括).toContain('当前摘要');
    expect(normalized.当前阶段概括).not.toContain('后期摘要');
    expect(normalized.核心角色).toContain('前期角色');
    expect(normalized.核心角色).not.toContain('后期角色');
  });

  it('内置世界书资源保留资料源与检索维度', () => {
    const raw: unknown = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/story-weaving-canon/wb_main_herta.json'), 'utf8'));
    const normalized = 归一化剧情编织系列(raw as Partial<剧情编织系列>);
    expect(normalized.剧情来源).toBe('世界书');
    expect(normalized.剧情分类).toBe('主线');
    expect(normalized.剧情地区).toBe('黑塔空间站');
    expect(normalized.分段列表.length).toBeGreaterThan(0);
    expect(normalized.分段列表.some((segment) => segment.标题 === '事件一')).toBe(true);
  });

  it('独立任务线不会自动跳到下一项任务', () => {
    const system = createStoryWeavingFixture();
    system.系列列表[0].剧情分类 = '支线';
    const result = autoAlignCanonStoryProgress({
      storyWeaving: system,
      turnCount: 8,
      body: '玩家完成了科琳的委托，回到筑梦边境。',
      userInput: '回到筑梦边境',
    });
    expect(result.changed).toBe(false);
    expect(result.progressed).toBe(false);
  });

  it('当前系列被手动暂停时，不会回退到别的系列继续判定', () => {
    const system = storySystem();
    system.系列列表[0].激活注入 = false;
    system.系列列表.push({
      ...series(),
      id: 'other_series',
      标题: '另一条主线',
    });
    expect(获取激活剧情系列(system)?.id).toBe('worldbook_test');
    expect(buildStoryAdvanceDeclarationContract(system)).toBe('');
  });

  it('手动恢复注入后要等新正文才消费暂停恢复标记', () => {
    const system = storySystem();
    if (system.当前进度) system.当前进度.暂停恢复待判定 = true;
    const oldBody = autoAlignCanonStoryProgress({
      storyWeaving: system,
      turnCount: 9,
      body: '暂停前的旧正文。',
      userInput: '继续',
    });
    expect(oldBody.changed).toBe(false);
    expect(oldBody.system.当前进度?.暂停恢复待判定).toBe(true);

    const newBody = autoAlignCanonStoryProgress({
      storyWeaving: system,
      turnCount: 10,
      body: '恢复注入后的新正文。',
      userInput: '继续',
      newBodySinceResume: true,
    });
    expect(newBody.system.当前进度?.暂停恢复待判定).toBe(false);
  });

  it('AI 判定不能把已经历分段重新改成当前', () => {
    const system = storySystem();
    const base = system.系列列表[0];
    base.分段列表[2].运行状态 = '已经历';
    const result = autoAlignCanonStoryProgress({
      storyWeaving: system,
      turnCount: 9,
      body: '正文试图直接跳到后续。',
      userInput: '继续',
      advanceJudge: { completed: false, actualSegmentId: 'seg_3', reason: '测试' },
    });
    expect(result.system.系列列表[0].分段列表[2].运行状态).toBe('已经历');
  });

  it('已经历分段不会进入 AI 批量分解目标', () => {
    const base = series();
    base.分段列表[0].运行状态 = '未开始';
    base.分段列表[2].运行状态 = '已经历';
    expect(selectBatchTargets(base, 'all').map((segment) => segment.id)).toEqual(['seg_1', 'seg_2']);
  });
});
