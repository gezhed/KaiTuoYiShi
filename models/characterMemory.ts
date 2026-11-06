/**
 * 角色记忆链接：Phase 1 的“事件 × 角色”层。
 *
 * 事件本身只记录“发生了什么、谁在场”；链接记录“这个角色是怎么知道的、有多确信、
 * 这件事对她意味着什么”。同一条事件对不同角色可以是亲历、目击、听说或背景印象。
 *
 * 链接挂在 `记忆系统.角色记忆` 下，与事件一起随存档的 `记忆` 字段落盘。
 */

import { type 记忆事件 } from './memoryEvent';

export type 角色记忆视角 = '亲历' | '目击' | '被告知' | '背景';
export type 角色记忆确信 = '确信' | '模糊' | '听说';
export type 角色记忆情绪 = '喜悦' | '愤怒' | '悲伤' | '恐惧' | '惊讶' | '厌恶' | '平静' | '复杂';
export type 角色记忆意义 = '承诺' | '冲突' | '亲密' | '损失' | '发现' | '日常';

export interface 角色记忆链接 {
  id: string;
  事件ID: string;
  角色: string;
  视角: 角色记忆视角;
  确信: 角色记忆确信;
  情绪?: 角色记忆情绪;
  意义: 角色记忆意义[];
  创建时间: number;
}

export const 角色记忆硬顶 = 2400;

/** Phase 2 最近提及抑制：记录某角色最近被注入过哪条事件，避免复读。 */
export interface 记忆注入记录 {
  事件ID: string;
  角色: string;
  回合: number;
}

export const 记忆注入历史硬顶 = 200;

export type 角色记忆清晰度 = '细节' | '画面' | '标签' | '影子';

const 视角权重: Record<角色记忆视角, number> = { 亲历: 1, 目击: 0.85, 被告知: 0.65, 背景: 0.4 };
const 确信权重: Record<角色记忆确信, number> = { 确信: 1, 模糊: 0.75, 听说: 0.55 };
const 意义权重: Record<角色记忆意义, number> = { 承诺: 0.35, 冲突: 0.3, 亲密: 0.22, 损失: 0.28, 发现: 0.2, 日常: 0 };
const 合法视角 = new Set<角色记忆视角>(['亲历', '目击', '被告知', '背景']);
const 合法确信 = new Set<角色记忆确信>(['确信', '模糊', '听说']);
const 合法情绪 = new Set<角色记忆情绪>(['喜悦', '愤怒', '悲伤', '恐惧', '惊讶', '厌恶', '平静', '复杂']);
const 合法意义 = new Set<角色记忆意义>(['承诺', '冲突', '亲密', '损失', '发现', '日常']);

const 情绪规则: ReadonlyArray<readonly [角色记忆情绪, RegExp]> = [
  ['愤怒', /愤怒|生气|恼火|怒|愤|咬牙|敌意/],
  ['悲伤', /悲伤|难过|哭|流泪|心痛|失落|哀/],
  ['恐惧', /恐惧|害怕|惊恐|发抖|不安|畏惧/],
  ['惊讶', /惊讶|震惊|意外|吃惊|愣住|愕然/],
  ['厌恶', /厌恶|恶心|反感|嫌恶|唾弃/],
  ['喜悦', /开心|高兴|喜悦|笑|欣慰|雀跃|欢喜/],
];

const 意义规则: ReadonlyArray<readonly [角色记忆意义, RegExp]> = [
  ['承诺', /承诺|约定|答应|发誓|保证|欠|人情|兑现/],
  ['冲突', /冲突|争吵|争执|敌对|攻击|威胁|翻脸|质疑|拒绝|动手/],
  ['亲密', /拥抱|亲吻|告白|喜欢|爱|信任|依赖|牵手|温柔|亲近/],
  ['损失', /死亡|死去|牺牲|重伤|失去|丢失|毁掉|摧毁|损坏/],
  ['发现', /发现|真相|秘密|揭露|得知|察觉|意识到|识破/],
];

export function 从事件派生角色记忆(event: 记忆事件, 排除角色: string[] = []): 角色记忆链接[] {
  const 排除 = new Set(排除角色.map((name) => name.trim()).filter(Boolean));
  for (const name of event.不在场) 排除.add(name.trim());
  const 证据文本 = [event.摘要, event.正文锚点 ?? ''].filter(Boolean).join(' ');
  const 情绪 = 推断角色记忆情绪(证据文本);
  const 意义 = 推断角色记忆意义(证据文本);
  const links = new Map<string, 角色记忆链接>();

  const add = (角色: string, 视角: 角色记忆视角, 确信: 角色记忆确信) => {
    const name = 角色.trim();
    if (!name || 排除.has(name)) return;
    const existing = links.get(name);
    if (existing && 视角权重[existing.视角] >= 视角权重[视角]) return;
    links.set(name, {
      id: `cml_${event.id}_${links.size.toString(36)}`,
      事件ID: event.id,
      角色: name,
      视角,
      确信,
      情绪,
      意义,
      创建时间: event.创建时间,
    });
  };

  for (const name of event.参与人) add(name, '亲历', '确信');
  for (const name of event.亲见) add(name, '目击', '确信');
  for (const name of event.被告知) add(name, '被告知', '听说');
  for (const name of event.背景在场) add(name, '背景', '模糊');

  return [...links.values()];
}

export function 推断角色记忆情绪(text: string): 角色记忆情绪 | undefined {
  for (const [emotion, pattern] of 情绪规则) {
    if (pattern.test(text)) return emotion;
  }
  return undefined;
}

export function 推断角色记忆意义(text: string): 角色记忆意义[] {
  const result: 角色记忆意义[] = [];
  for (const [meaning, pattern] of 意义规则) {
    if (pattern.test(text)) result.push(meaning);
    if (result.length >= 3) break;
  }
  return result.length ? result : ['日常'];
}

/** 0~2 的确定性重要度；不调模型，只吃视角、确信、标签和新近度。 */
export function 计算角色记忆重要度(link: 角色记忆链接, event: 记忆事件, currentTurn: number): number {
  const 核心 = 0.55 * 视角权重[link.视角] + 0.45 * 确信权重[link.确信];
  const 意义加成 = Math.min(0.5, link.意义.reduce((sum, item) => sum + 意义权重[item], 0));
  const 情绪加成 = link.情绪 ? 0.12 : 0;
  const 距离 = Math.max(0, Math.floor(currentTurn) - event.回合);
  const 新近度 = 1 / (1 + 距离 / 40);
  return Math.min(2, (核心 + 意义加成 + 情绪加成) * (0.6 + 0.4 * 新近度));
}

/**
 * 四档清晰度：按当前重要度衰减决定这条记忆还能被“冲印”出多少细节。
 * 细节/画面给原文与摘要，标签只给情绪与意义，影子只保留“发生过”的印象。
 */
export function 判断角色记忆清晰度(
  link: 角色记忆链接,
  event: 记忆事件,
  currentTurn: number,
): 角色记忆清晰度 {
  const importance = 计算角色记忆重要度(link, event, currentTurn);
  if (importance >= 1.15) return '细节';
  if (importance >= 0.85) return '画面';
  if (importance >= 0.55) return '标签';
  return '影子';
}

/** 本地冲印：不额外调模型，只按清晰度选择呈现粒度，让主模型自己组织语气。 */
export function 冲印角色记忆(link: 角色记忆链接, event: 记忆事件, clarity: 角色记忆清晰度): string {
  const summary = event.摘要.replace(/\s+/g, ' ').trim().slice(0, 140);
  const tag = `【第${event.回合}回合·${link.视角}·${link.确信}`;
  if (clarity === '细节') {
    const anchor = (event.正文锚点 ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return `- ${tag}·细节】${summary}${anchor ? `（细节：${anchor}）` : ''}`;
  }
  if (clarity === '画面') {
    return `- ${tag}·画面】${summary}`;
  }
  if (clarity === '标签') {
    return `- ${tag}·标签】情绪：${link.情绪 ?? '平静'}；意义：${link.意义.join('、')}。只剩大致印象。`;
  }
  return `- 【第${event.回合}回合】只记得有过这么一回事，细节已经模糊。`;
}

export interface 角色记忆命中 {
  link: 角色记忆链接;
  event: 记忆事件;
  score: number;
}

/** 召回解释：把重要度、文本相关度、清晰度和抑制状态拆开，供诊断面板使用。 */
export interface 角色记忆命中解释 {
  link: 角色记忆链接;
  event: 记忆事件;
  importance: number;
  relevance: number;
  score: number;
  clarity: 角色记忆清晰度;
  suppressed: boolean;
}

export function 解释角色记忆命中(input: {
  links: 角色记忆链接[];
  events: 记忆事件[];
  role: string | string[];
  query: string;
  currentTurn: number;
  history?: 记忆注入记录[];
  suppressTurns?: number;
}): 角色记忆命中解释[] {
  const events = new Map(input.events.map((event) => [event.id, event]));
  const queryTokens = 关键词集合(input.query);
  const roles = new Set(Array.isArray(input.role) ? input.role : [input.role]);
  const suppressed = new Set<string>();
  const suppressTurns = Math.max(0, input.suppressTurns ?? 0);
  if (suppressTurns > 0) {
    for (const record of input.history ?? []) {
      if (input.currentTurn - record.回合 <= suppressTurns) {
        suppressed.add(`${record.事件ID}|${record.角色}`);
      }
    }
  }
  const rows: 角色记忆命中解释[] = [];
  for (const link of input.links) {
    if (!roles.has(link.角色)) continue;
    const event = events.get(link.事件ID);
    if (!event) continue;
    const relevance = 文本相关度(queryTokens, [event.摘要, event.正文锚点 ?? '', event.地点 ?? ''].join(' '));
    const importance = 计算角色记忆重要度(link, event, input.currentTurn);
    rows.push({
      link,
      event,
      importance,
      relevance,
      score: importance * (0.7 + 0.3 * relevance),
      clarity: 判断角色记忆清晰度(link, event, input.currentTurn),
      suppressed: suppressed.has(`${link.事件ID}|${link.角色}`),
    });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows;
}

/** 按重要度 × 与当前输入的文本相关度排序；只返回仍能对上事件的链接。 */
export function 选择角色记忆(input: {
  links: 角色记忆链接[];
  events: 记忆事件[];
  role: string | string[];
  query: string;
  currentTurn: number;
  limit: number;
  history?: 记忆注入记录[];
  suppressTurns?: number;
}): 角色记忆命中[] {
  return 解释角色记忆命中(input)
    .filter((row) => !row.suppressed)
    .slice(0, Math.max(0, Math.floor(input.limit)))
    .map(({ link, event, score }) => ({ link, event, score }));
}

export function 剪裁角色记忆(links: 角色记忆链接[], events: 记忆事件[]): 角色记忆链接[] {
  const alive = new Set(events.map((event) => event.id));
  return links.filter((link) => alive.has(link.事件ID));
}

export function 封顶角色记忆(links: 角色记忆链接[], max: number = 角色记忆硬顶): 角色记忆链接[] {
  if (!Array.isArray(links) || links.length <= max) return links;
  return links.slice(-Math.max(1, max));
}

export function 归一化角色记忆(input: unknown, issues: string[]): 角色记忆链接[] {
  if (!Array.isArray(input)) {
    if (input !== undefined) issues.push('角色记忆不是数组，已置空。');
    return [];
  }
  const result: 角色记忆链接[] = [];
  const seen = new Set<string>();
  let invalidCount = 0;
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      invalidCount += 1;
      continue;
    }
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const 事件ID = typeof item.事件ID === 'string' ? item.事件ID.trim() : '';
    const 角色 = typeof item.角色 === 'string' ? item.角色.trim() : '';
    if (!id || !事件ID || !角色 || seen.has(id)) {
      invalidCount += 1;
      continue;
    }
    seen.add(id);
    const 意义 = Array.isArray(item.意义)
      ? item.意义.filter((value): value is 角色记忆意义 => typeof value === 'string' && 合法意义.has(value as 角色记忆意义))
      : [];
    result.push({
      id,
      事件ID,
      角色,
      视角: 合法视角.has(item.视角 as 角色记忆视角) ? (item.视角 as 角色记忆视角) : '背景',
      确信: 合法确信.has(item.确信 as 角色记忆确信) ? (item.确信 as 角色记忆确信) : '模糊',
      情绪: 合法情绪.has(item.情绪 as 角色记忆情绪) ? (item.情绪 as 角色记忆情绪) : undefined,
      意义: 意义.length ? 意义.slice(0, 3) : ['日常'],
      创建时间: typeof item.创建时间 === 'number' && Number.isFinite(item.创建时间) ? item.创建时间 : 0,
    });
  }
  if (invalidCount) issues.push(`角色记忆含 ${invalidCount} 条非法项，已清除。`);
  return 封顶角色记忆(result);
}

function 关键词集合(text: string): Set<string> {
  const tokens = new Set<string>();
  const words = text.toLowerCase().match(/[a-z0-9]{2,}|[\u4e00-\u9fa5]{2,}/g) ?? [];
  for (const word of words) {
    if (/^[a-z0-9]/.test(word)) {
      tokens.add(word);
      continue;
    }
    for (let i = 0; i < word.length - 1; i += 1) tokens.add(word.slice(i, i + 2));
  }
  return tokens;
}

function 文本相关度(queryTokens: Set<string>, text: string): number {
  if (!queryTokens.size) return 0;
  const textTokens = 关键词集合(text);
  let matched = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) matched += 1;
  }
  return Math.min(1, matched / Math.min(8, queryTokens.size));
}

export function 归一化记忆注入记录(input: unknown, issues: string[]): 记忆注入记录[] {
  if (!Array.isArray(input)) {
    if (input !== undefined) issues.push('记忆注入历史不是数组，已置空。');
    return [];
  }
  const byKey = new Map<string, 记忆注入记录>();
  let invalidCount = 0;
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      invalidCount += 1;
      continue;
    }
    const item = raw as Record<string, unknown>;
    const 事件ID = typeof item.事件ID === 'string' ? item.事件ID.trim() : '';
    const 角色 = typeof item.角色 === 'string' ? item.角色.trim() : '';
    const 回合 = typeof item.回合 === 'number' && Number.isFinite(item.回合) ? Math.trunc(item.回合) : 0;
    if (!事件ID || !角色 || !回合) {
      invalidCount += 1;
      continue;
    }
    const key = `${事件ID}|${角色}`;
    const existing = byKey.get(key);
    if (!existing || existing.回合 <= 回合) byKey.set(key, { 事件ID, 角色, 回合 });
  }
  if (invalidCount) issues.push(`记忆注入历史含 ${invalidCount} 条非法项，已清除。`);
  return [...byKey.values()].slice(-记忆注入历史硬顶);
}
