/**
 * 每幕整理：剧情进入下一幕后，把上一幕的角色记忆链接压成一条“旧幕印象”，
 * 并从逐条链接里移除，避免几十回合后角色记忆被旧幕细节淹没。
 *
 * 事件本身不删除（仍可被向量召回），只压缩“角色逐条记得的细节”。
 */

import type { 记忆事件 } from './memoryEvent';
import type { 角色记忆链接 } from './characterMemory';
import { 推断角色记忆意义 } from './characterMemory';

export interface 幕记忆 {
  id: string;
  组号: number;
  标题: string;
  起止回合: [number, number];
  摘要: string;
  事件数: number;
  角色: string[];
  创建时间: number;
}

export const 幕记忆硬顶 = 24;
const 单幕事件上限 = 8;
const 单幕摘要上限 = 900;

const 意义分: Record<string, number> = {
  承诺: 3,
  冲突: 2.6,
  损失: 2.8,
  亲密: 2.2,
  发现: 1.6,
  日常: 0,
};

function 事件分量(event: 记忆事件): number {
  const tags = 推断角色记忆意义([event.摘要, event.正文锚点 ?? ''].join(' '));
  let score = tags.reduce((sum, tag) => sum + (意义分[tag] ?? 0), 0);
  score += Math.min(2, event.参与人.length * 0.3);
  if (event.公开度 === '公开') score += 0.2;
  return score;
}

/**
 * 把 fromTurn（不含）到 currentTurn（不含）之间的事件整理成一幕。
 * 不足 6 条事件时返回 null，避免无意义的“幕摘要”。
 */
export function 整理幕记忆(input: {
  events: 记忆事件[];
  links: 角色记忆链接[];
  组号: number;
  标题: string;
  fromTurn: number;
  currentTurn: number;
  now: number;
}): { act: 幕记忆 | null; remainingLinks: 角色记忆链接[] } {
  const old = input.events.filter((event) => event.回合 > input.fromTurn && event.回合 < input.currentTurn);
  if (old.length < 6) return { act: null, remainingLinks: input.links };

  const ranked = [...old]
    .sort((a, b) => 事件分量(b) - 事件分量(a))
    .slice(0, 单幕事件上限)
    .sort((a, b) => a.回合 - b.回合);
  const lines = ranked.map((event) => {
    const people = event.参与人.slice(0, 3).join('、');
    return `- 第${event.回合}回合：${event.摘要.replace(/\s+/g, ' ').trim().slice(0, 70)}${people ? `（${people}）` : ''}`;
  });
  const title = input.标题.trim() || `第${input.组号}幕`;
  const 摘要 = `【第${input.组号}幕·${title}】\n${lines.join('\n')}`.slice(0, 单幕摘要上限);
  const turns = old.map((event) => event.回合);
  const 角色 = [...new Set(old.flatMap((event) => event.参与人))].filter(Boolean).slice(0, 24);
  const covered = new Set(old.map((event) => event.id));
  return {
    act: {
      id: `act_${input.组号}_${input.now.toString(36)}`,
      组号: input.组号,
      标题: title,
      起止回合: [Math.min(...turns), Math.max(...turns)],
      摘要,
      事件数: old.length,
      角色,
      创建时间: input.now,
    },
    remainingLinks: input.links.filter((link) => !covered.has(link.事件ID)),
  };
}

export function 封顶幕记忆(acts: 幕记忆[], max: number = 幕记忆硬顶): 幕记忆[] {
  if (!Array.isArray(acts) || acts.length <= max) return acts;
  return acts.slice(-Math.max(1, max));
}

export function 归一化幕记忆(input: unknown, issues: string[]): 幕记忆[] {
  if (!Array.isArray(input)) {
    if (input !== undefined) issues.push('幕记忆不是数组，已置空。');
    return [];
  }
  const result: 幕记忆[] = [];
  const seen = new Set<string>();
  let invalidCount = 0;
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      invalidCount += 1;
      continue;
    }
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const 组号 = typeof item.组号 === 'number' && Number.isFinite(item.组号) ? Math.trunc(item.组号) : 0;
    const 标题 = typeof item.标题 === 'string' ? item.标题.trim() : '';
    const 摘要 = typeof item.摘要 === 'string' ? item.摘要.trim().slice(0, 单幕摘要上限) : '';
    const rawRange = item.起止回合;
    const 起止回合: [number, number] = Array.isArray(rawRange) && rawRange.length >= 2
      && typeof rawRange[0] === 'number' && typeof rawRange[1] === 'number'
      ? [Math.trunc(rawRange[0]), Math.trunc(rawRange[1])]
      : [0, 0];
    if (!id || !组号 || !摘要 || seen.has(id)) {
      invalidCount += 1;
      continue;
    }
    seen.add(id);
    result.push({
      id,
      组号,
      标题: 标题 || `第${组号}幕`,
      起止回合,
      摘要,
      事件数: typeof item.事件数 === 'number' && Number.isFinite(item.事件数) ? Math.max(0, Math.trunc(item.事件数)) : 0,
      角色: Array.isArray(item.角色)
        ? item.角色.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).slice(0, 24)
        : [],
      创建时间: typeof item.创建时间 === 'number' && Number.isFinite(item.创建时间) ? item.创建时间 : 0,
    });
  }
  if (invalidCount) issues.push(`幕记忆含 ${invalidCount} 条非法项，已清除。`);
  return 封顶幕记忆(result);
}
