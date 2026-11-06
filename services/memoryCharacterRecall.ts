import type { 记忆事件 } from '@/models/memoryEvent';
import type { 幕记忆 } from '@/models/memoryAct';
import {
  冲印角色记忆,
  判断角色记忆清晰度,
  选择角色记忆,
  type 记忆注入记录,
  type 角色记忆链接,
} from '@/models/characterMemory';
import type { NPC记录 } from '@/models/npc';

const 每批最多角色数 = 4;

export interface 角色记忆注入标记 {
  事件ID: string;
  角色: string;
  回合: number;
}

export interface 角色记忆注入结果 {
  injection: string;
  characters: Array<{ name: string; count: number }>;
  marks: 角色记忆注入标记[];
}

/**
 * stage2 构建注入后把“这次真正发出去的条目”暂存；stage6 再并入存档。
 * 模块级队列只在同一回合内使用，不跨会话保存；持久化的是 `记忆系统.注入历史`。
 */
let pendingMarks: 角色记忆注入标记[] = [];

export function markCharacterMemoryInjected(marks: 角色记忆注入标记[]): void {
  if (marks.length) pendingMarks.push(...marks);
}

export function drainCharacterMemoryMarks(): 角色记忆注入标记[] {
  const marks = pendingMarks;
  pendingMarks = [];
  return marks;
}

export function 清空角色记忆注入标记(): void {
  pendingMarks = [];
}

/** 只给“当前可能在场”的角色注入：同行，或本轮上下文点名的角色。 */
export function 选择在场角色(
  records: NPC记录[],
  names: string[],
  limit: number = 每批最多角色数,
): NPC记录[] {
  const wanted = new Set(names.map((name) => name.trim()).filter(Boolean));
  const result: NPC记录[] = [];
  for (const record of records) {
    const aliases = [record.姓名, ...(record.别名 ?? '').split(/[、,，/／\s]+/)]
      .map((name) => name.trim())
      .filter(Boolean);
    if (record.同行 || aliases.some((name) => wanted.has(name))) {
      result.push(record);
    }
    if (result.length >= limit) break;
  }
  return result;
}

/** 未了之事直接取伙伴系统已有的三类持久字段，不另造状态。 */
function 收集未了之事(roles: NPC记录[], limit: number): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const push = (text: string) => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    const key = normalized.slice(0, 48);
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(`- ${normalized}`);
  };
  for (const role of roles) {
    for (const item of role.未完成事项 ?? []) push(`与${role.姓名}尚未了结：${item}`);
    for (const item of role.未解决冲突 ?? []) push(`与${role.姓名}尚未解决：${item}`);
    for (const item of role.约定 ?? []) {
      if (item.当前状态 !== '等待中') continue;
      const content = (item.内容 || item.标题).trim();
      if (!content) continue;
      push(`与${role.姓名}的约定：${content}${item.约定时间 ? `（约定时间：${item.约定时间}）` : ''}`);
    }
    if (lines.length >= limit) break;
  }
  return lines.slice(0, limit);
}

function 收集旧幕(
  acts: 幕记忆[],
  roles: NPC记录[],
  budget: number,
  used: number,
): { lines: string[]; used: number } {
  const present = new Set(roles.map((role) => role.姓名));
  const lines: string[] = [];
  let cursor = used;
  for (const act of acts.slice(-2)) {
    if (!act.角色.some((name) => present.has(name))) continue;
    const body = act.摘要.split('\n').filter((line) => line.startsWith('- ')).slice(0, 2);
    if (!body.length) continue;
    const block = `## 旧幕·${act.标题}（第${act.起止回合[0]}-${act.起止回合[1]}回合）\n${body.join('\n')}`;
    if (cursor + block.length + 1 > budget) break;
    lines.push(block);
    cursor += block.length + 1;
  }
  return { lines, used: cursor };
}

/**
 * 构建“角色记忆”注入段。每个角色只拿自己视角下最相关的几条；
 * 明确告诉主模型这是角色视角，不是全知事实。
 */
export function buildCharacterMemoryInjection(input: {
  records: NPC记录[];
  links: 角色记忆链接[];
  events: 记忆事件[];
  names: string[];
  query: string;
  currentTurn: number;
  perCharacterLimit: number;
  budget: number;
  history?: 记忆注入记录[];
  suppressTurns?: number;
  acts?: 幕记忆[];
  未了之事启用?: boolean;
  未了之事条数?: number;
}): 角色记忆注入结果 {
  const roles = 选择在场角色(input.records, input.names);
  const blocks: string[] = [];
  const characters: Array<{ name: string; count: number }> = [];
  const marks: 角色记忆注入标记[] = [];
  let used = 0;
  const header = '以下是当前在场角色本人记得的事。每条只代表该角色的视角，不是全知事实；标着「听说」「模糊」的内容她可能记错。清晰度从高到低为：细节、画面、标签、影子。';
  const limit = Math.max(1, Math.floor(input.perCharacterLimit));

  for (const role of roles) {
    const aliases = [role.姓名, ...(role.别名 ?? '').split(/[、,，/／\s]+/)]
      .map((name) => name.trim())
      .filter(Boolean);
    const hits = 选择角色记忆({
      links: input.links,
      events: input.events,
      role: aliases,
      query: input.query,
      currentTurn: input.currentTurn,
      limit,
      history: input.history,
      suppressTurns: input.suppressTurns ?? 0,
    });
    if (!hits.length) continue;
    const lines: string[] = [];
    for (const hit of hits) {
      const clarity = 判断角色记忆清晰度(hit.link, hit.event, input.currentTurn);
      const line = 冲印角色记忆(hit.link, hit.event, clarity);
      if (used + line.length + 1 > input.budget) break;
      lines.push(line);
      used += line.length + 1;
      marks.push({ 事件ID: hit.event.id, 角色: role.姓名, 回合: input.currentTurn });
    }
    if (!lines.length) continue;
    const block = `## ${role.姓名}\n${lines.join('\n')}`;
    if (used + block.length + 1 > input.budget && blocks.length) break;
    blocks.push(block);
    characters.push({ name: role.姓名, count: lines.length });
    used += block.length + 1;
    if (used >= input.budget) break;
  }

  const sections: string[] = [];
  if (blocks.length) sections.push(blocks.join('\n\n'));

  const actBlock = 收集旧幕(input.acts ?? [], roles, input.budget, used);
  used = actBlock.used;
  if (actBlock.lines.length) sections.push(actBlock.lines.join('\n\n'));

  if (input.未了之事启用 !== false) {
    const threads = 收集未了之事(roles, Math.max(1, Math.floor(input.未了之事条数 ?? 5)));
    if (threads.length) {
      const block = `## 未了之事\n${threads.join('\n')}`;
      if (used + block.length + 1 <= input.budget) {
        sections.push(block);
      }
    }
  }

  if (!sections.length) return { injection: '', characters: [], marks: [] };
  return { injection: `${header}\n\n${sections.join('\n\n')}`, characters, marks };
}
