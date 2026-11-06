import type { NPC记录 } from './npc';
import type { NPC关系脉络 } from './npcRelationship';
import type { 记忆事件 } from './memoryEvent';

/**
 * 朋友圈动态：角色在主线之外的生活切片。
 *
 * 它不推进主线，只补充“这个角色不在场时在做什么”。知情范围由关系脉络决定：
 * 只有和作者有直接关系的人，才会把这条动态当成“我知道的事”。
 */
export interface 朋友圈图片 {
  /** 已压缩的 data URL；直接写进动态，避免依赖相册引用在旧档里失效。 */
  数据地址: string;
  宽度: number;
  高度: number;
}

export interface 朋友圈动态 {
  id: string;
  /** 作者对应的 NPC 记录 id；旧档或资料库角色可能没有。 */
  作者NPCID?: string;
  作者姓名: string;
  回合: number;
  内容: string;
  /** 配图描述；开启朋友圈生图时也会作为出图提示词。 */
  配图?: string;
  /** 已生成的配图；没有生成或生成失败时只有描述。 */
  图片?: 朋友圈图片;
  /** 通过关系网能知道这条动态的角色姓名。 */
  知情角色: string[];
  创建时间: number;
}

export interface 朋友圈作者候选 {
  npc: NPC记录;
  /** 最近一次发朋友圈的回合；没有发过为 0。 */
  最近发布回合: number;
}

export const 朋友圈动态硬顶 = 60;

/** 单张朋友圈配图的大小上限；超过就丢弃，避免把存档撑爆。 */
export const 朋友圈图片字符上限 = 1_800_000;

export function 归一化朋友圈图片(input: unknown): 朋友圈图片 | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Record<string, unknown>;
  const 数据地址 = typeof raw.数据地址 === 'string' ? raw.数据地址.trim() : '';
  if (!数据地址.startsWith('data:image/') || 数据地址.length > 朋友圈图片字符上限) return undefined;
  const 宽度 = typeof raw.宽度 === 'number' && Number.isFinite(raw.宽度) ? Math.max(1, Math.round(raw.宽度)) : 0;
  const 高度 = typeof raw.高度 === 'number' && Number.isFinite(raw.高度) ? Math.max(1, Math.round(raw.高度)) : 0;
  return { 数据地址, 宽度, 高度 };
}

/** 朋友圈配图提示词：强调“生活随拍”，避免出成海报或带文字。 */
export function 构建朋友圈配图提示词(作者姓名: string, 描述: string): string {
  const 作者 = 作者姓名.trim() || '角色';
  const 画面 = 描述.trim().slice(0, 160) || '日常生活中的一个片段';
  return `${作者}的朋友圈生活照：${画面}。手机随手拍，自然光，真实生活感，不摆拍，不出现文字、水印和边框。`;
}

/** 闭区间随机整数；random 可注入，方便测试。 */
export function 随机整数(min: number, max: number, random: () => number = Math.random): number {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  if (high <= low) return low;
  const r = Math.min(0.999999, Math.max(0, random()));
  return low + Math.floor(r * (high - low + 1));
}

/** 下一次朋友圈回合：当前回合 + [min,max] 的随机间隔。 */
export function 计算朋友圈下次回合(
  turn: number,
  min: number,
  max: number,
  random: () => number = Math.random,
): number {
  return Math.max(0, Math.floor(turn)) + 随机整数(min, max, random);
}

function 姓名集合(npc: NPC记录): string[] {
  return [npc.姓名, npc.别名]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function 在姓名集合中(names: Set<string>, npc: NPC记录): boolean {
  return 姓名集合(npc).some((name) => names.has(name));
}

/**
 * 抽取朋友圈作者。
 *
 * 硬条件：必须是通讯录里已解锁、且能落到 NPC 记录上的角色；必须在场之外。
 * 排序：越久没发过的人越优先，避免总是同一批人刷屏。
 */
export function 选取朋友圈作者(input: {
  contacts: Array<{ name: string; npcId?: string; available: boolean }>;
  npcs: NPC记录[];
  presentNames: string[];
  min: number;
  max: number;
  /** 最近已经发过、本轮需要避开的角色姓名。 */
  recentAuthors?: string[];
  random?: () => number;
}): NPC记录[] {
  const random = input.random ?? Math.random;
  const present = new Set(input.presentNames.map((name) => name.trim()).filter(Boolean));
  const recent = new Set((input.recentAuthors ?? []).map((name) => name.trim()).filter(Boolean));
  const byId = new Map(input.npcs.map((npc) => [npc.id, npc]));
  const candidates: 朋友圈作者候选[] = [];

  for (const contact of input.contacts) {
    if (!contact.available || !contact.npcId) continue;
    const npc = byId.get(contact.npcId);
    if (!npc) continue;
    if (在姓名集合中(present, npc)) continue;
    if (在姓名集合中(recent, npc)) continue;
    candidates.push({ npc, 最近发布回合: npc.最近回合 || 0 });
  }

  const unique = new Map<string, 朋友圈作者候选>();
  for (const item of candidates) {
    if (!unique.has(item.npc.id)) unique.set(item.npc.id, item);
  }
  const ordered = [...unique.values()].sort((a, b) => {
    if (a.最近发布回合 !== b.最近发布回合) return a.最近发布回合 - b.最近发布回合;
    return random() - 0.5;
  });

  const count = Math.min(随机整数(input.min, input.max, random), ordered.length);
  return ordered.slice(0, Math.max(0, count)).map((item) => item.npc);
}

function 规整姓名(name: string): string {
  return name.trim().replace(/\s+/g, '').toLowerCase();
}

function 解析关系目标(edge: NPC关系脉络): string {
  return (edge.目标姓名 || '').trim();
}

/**
 * 关系网知情：作者关系脉络里的目标 + 反向关系里指向作者的人。
 *
 * 这是“谁能看到这条朋友圈”的唯一依据，不做全通讯录广播。
 */
export function 收集朋友圈知情角色(author: NPC记录, npcs: NPC记录[]): string[] {
  const authorNames = new Set(姓名集合(author).map(规整姓名));
  const related = new Set<string>();
  const byName = new Map<string, NPC记录>();

  for (const npc of npcs) {
    for (const name of 姓名集合(npc)) byName.set(规整姓名(name), npc);
    if (npc.id === author.id) continue;
    for (const edge of npc.关系脉络 ?? []) {
      if (authorNames.has(规整姓名(解析关系目标(edge)))) related.add(npc.姓名);
    }
  }

  for (const edge of author.关系脉络 ?? []) {
    const target = 解析关系目标(edge);
    if (!target) continue;
    const npc = byName.get(规整姓名(target));
    if (npc && npc.id !== author.id) related.add(npc.姓名);
  }

  return [...related].filter(Boolean).slice(0, 12);
}

/** 用关系网给动态补“谁知道了”。 */
export function 补全朋友圈知情角色(moment: 朋友圈动态, npcs: NPC记录[]): 朋友圈动态 {
  const author = npcs.find((npc) => npc.id === moment.作者NPCID || 姓名集合(npc).includes(moment.作者姓名));
  if (!author) return { ...moment, 知情角色: [...new Set(moment.知情角色)].slice(0, 12) };
  return {
    ...moment,
    知情角色: 收集朋友圈知情角色(author, npcs),
  };
}

export interface 朋友圈生成条目 {
  作者: string;
  内容: string;
  配图?: string;
}

/** 交给生成模型的上下文：只包含本批作者与最近动态，避免全知。 */
export interface 朋友圈生成上下文 {
  authors: NPC记录[];
  recentPosts: 朋友圈动态[];
  turn: number;
  travelerName: string;
  location?: string;
  time?: string;
}

/**
 * 把模型输出对齐到实际作者上；作者名对不上的条目丢弃，避免生成“幽灵角色”动态。
 */
export function 归一化朋友圈生成结果(
  input: unknown,
  authors: NPC记录[],
): 朋友圈生成条目[] {
  const rawList = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as { posts?: unknown }).posts)
      ? (input as { posts: unknown[] }).posts
      : [];
  const byName = new Map<string, NPC记录>();
  for (const npc of authors) {
    for (const name of 姓名集合(npc)) byName.set(规整姓名(name), npc);
  }
  const seen = new Set<string>();
  const result: 朋友圈生成条目[] = [];
  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const authorName = typeof item.作者 === 'string' ? item.作者.trim() : '';
    const content = typeof item.内容 === 'string' ? item.内容.trim() : '';
    if (!authorName || !content) continue;
    const npc = byName.get(规整姓名(authorName));
    if (!npc || seen.has(npc.id)) continue;
    seen.add(npc.id);
    result.push({
      作者: npc.姓名,
      内容: content.slice(0, 500),
      配图: typeof item.配图 === 'string' && item.配图.trim() ? item.配图.trim().slice(0, 120) : undefined,
    });
  }
  return result;
}

export function 创建朋友圈动态(input: {
  author: NPC记录;
  content: string;
  turn: number;
  audience: string[];
  now?: number;
  配图?: string;
  图片?: 朋友圈图片;
}): 朋友圈动态 {
  const now = input.now ?? Date.now();
  return {
    id: `moment_${Math.max(0, Math.floor(input.turn))}_${now}_${Math.random().toString(36).slice(2, 7)}`,
    作者NPCID: input.author.id,
    作者姓名: input.author.姓名,
    回合: Math.max(0, Math.floor(input.turn)),
    内容: input.content.trim().slice(0, 500),
    配图: input.配图?.trim().slice(0, 120) || undefined,
    图片: 归一化朋友圈图片(input.图片),
    知情角色: [...new Set(input.audience)].filter(Boolean).slice(0, 12),
    创建时间: now,
  };
}

export function 封顶朋友圈动态(list: 朋友圈动态[], max: number = 朋友圈动态硬顶): 朋友圈动态[] {
  if (!Array.isArray(list) || list.length <= max) return list;
  return list.slice(-Math.max(1, max));
}

export function 归一化朋友圈动态(input: unknown): 朋友圈动态[] {
  if (!Array.isArray(input)) return [];
  const result: 朋友圈动态[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const author = typeof item.作者姓名 === 'string' ? item.作者姓名.trim() : '';
    const content = typeof item.内容 === 'string' ? item.内容.trim() : '';
    if (!id || !author || !content || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      作者NPCID: typeof item.作者NPCID === 'string' ? item.作者NPCID : undefined,
      作者姓名: author,
      回合: typeof item.回合 === 'number' && Number.isFinite(item.回合) ? Math.max(0, Math.floor(item.回合)) : 0,
      内容: content.slice(0, 500),
      配图: typeof item.配图 === 'string' && item.配图.trim() ? item.配图.trim().slice(0, 120) : undefined,
      图片: 归一化朋友圈图片(item.图片),
      知情角色: Array.isArray(item.知情角色)
        ? [...new Set(item.知情角色.filter((name): name is string => typeof name === 'string').map((name) => name.trim()).filter(Boolean))].slice(0, 12)
        : [],
      创建时间: typeof item.创建时间 === 'number' && Number.isFinite(item.创建时间) ? item.创建时间 : Date.now(),
    });
  }
  return 封顶朋友圈动态(result);
}

/** 朋友圈动态 → 记忆事件；公开度固定半公开，知情角色进“被告知”。 */
export function 构建朋友圈记忆事件(input: {
  moment: 朋友圈动态;
  参与人?: string[];
  now?: number;
}): 记忆事件 {
  const now = input.now ?? input.moment.创建时间;
  return {
    id: `evt_moment_${input.moment.id}`,
    回合: input.moment.回合,
    摘要: `朋友圈：${input.moment.作者姓名}发布了动态「${input.moment.内容.slice(0, 80)}」。`,
    参与人: input.参与人 ?? [input.moment.作者姓名],
    亲见: [],
    被告知: input.moment.知情角色,
    不在场: [],
    背景在场: [],
    公开度: '半公开',
    来源: '导入',
    置信: '高',
    正文锚点: input.moment.内容,
    创建时间: now,
  };
}
