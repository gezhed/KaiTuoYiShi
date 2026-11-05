/**
 * 记忆事件：Phase 0 的“知情映射 → 事件台账”最小闭环。
 *
 * 只记录“本回合正文里真实成立的一件事 + 谁在场/谁亲见/谁被告知/谁不在场”。
 * 它不是 NPC 的完整记忆，也还不是角色视角；Phase 1 才会在事件上挂角色链接。
 *
 * 数据暂时挂在 `记忆系统.事件` 下，随存档的 `记忆` 字段一起落盘，
 * 这样不需要改动存档树/增量写入的字段协议；Phase 1 再迁到独立顶层字段。
 */

export const MEMORY_EVENT_MAX = 500;

export type 知情公开度 = '公开' | '半公开' | '私密' | '未知';
export type 记忆事件来源 = '正文' | '导入' | '手动';
export type 记忆事件置信 = '高' | '低';

export interface 记忆事件 {
  id: string;
  回合: number;
  时间?: string;
  地点?: string;
  /** 一句话事实摘要；优先取本回合小結，其次取正文开头。 */
  摘要: string;
  /** 本回合实际出现在场景中的人（含玩家）。 */
  参与人: string[];
  /** 亲眼看到 / 亲耳听到核心事件的人。 */
  亲见: string[];
  /** 本回合内被告知而得知的人。 */
  被告知: string[];
  /** 明确不在场、不应知道的人。 */
  不在场: string[];
  /** 思维链计划在场、但正文没有实际动作的人；可目击但不主动参与。 */
  背景在场: string[];
  公开度: 知情公开度;
  来源: 记忆事件来源;
  置信: 记忆事件置信;
  /** 正文证据节选，防止事件脱离正文。 */
  正文锚点?: string;
  /** 原始知情映射行，便于诊断与回溯。 */
  映射原文?: string;
  创建时间: number;
}

export interface 知情映射 {
  在场: string[];
  亲见: string[];
  被告知: string[];
  不在场: string[];
  背景在场: string[];
  公开度: 知情公开度;
  原文: string;
}

const MARKER = '【知情映射】';
const 无名项 = new Set(['无', '没有', '暂无', '无人', '—', '-', '/']);
const 公开度集合 = new Set<知情公开度>(['公开', '半公开', '私密', '未知']);
const 来源集合 = new Set<记忆事件来源>(['正文', '导入', '手动']);
const 置信集合 = new Set<记忆事件置信>(['高', '低']);

/** 从思维链里取出知情映射那一段；最多吞 4 行，避免把后续说明也算进去。 */
export function 提取知情映射文本(thinking: string | undefined): string | null {
  if (typeof thinking !== 'string' || !thinking) return null;
  const index = thinking.lastIndexOf(MARKER);
  if (index < 0) return null;
  const tail = thinking.slice(index + MARKER.length).trim();
  if (!tail) return null;
  return tail.split(/\r?\n/).slice(0, 4).join('；').trim();
}

export function 解析知情映射(thinking: string | undefined): 知情映射 | null {
  const text = 提取知情映射文本(thinking);
  if (!text) return null;

  const 在场: string[] = [];
  const 亲见: string[] = [];
  const 被告知: string[] = [];
  const 不在场: string[] = [];
  const 背景在场: string[] = [];
  let 公开度: 知情公开度 = '未知';
  let matched = false;

  for (const segment of text.split(/[；;\n]/)) {
    const hit = segment.match(/^\s*(在场|背景在场|亲见|被告知|不在场|公开度)\s*[:：]\s*(.*)$/);
    if (!hit) continue;
    matched = true;
    const key = hit[1];
    const raw = hit[2];
    if (key === '公开度') {
      公开度 = 归一化公开度(raw);
    } else if (key === '在场') {
      在场.push(...拆名(raw));
    } else if (key === '亲见') {
      亲见.push(...拆名(raw));
    } else if (key === '被告知') {
      被告知.push(...拆名(raw));
    } else if (key === '不在场') {
      不在场.push(...拆名(raw));
    } else {
      背景在场.push(...拆名(raw));
    }
  }

  if (!matched) return null;

  const 已确认 = new Set([...在场, ...亲见, ...被告知, ...背景在场]);
  return {
    在场: 去重(在场),
    亲见: 去重(亲见),
    被告知: 去重(被告知),
    不在场: 去重(不在场).filter((name) => !已确认.has(name)),
    背景在场: 去重(背景在场),
    公开度,
    原文: text,
  };
}

export function 构建记忆事件FromReply(input: {
  turn: number;
  thinking: string;
  body: string;
  summary: string;
  worldTime?: string;
  location?: string;
  now: number;
}): 记忆事件 | null {
  const mapping = 解析知情映射(input.thinking);
  if (!mapping) return null;

  const summaryText = 清洗(input.summary);
  const hasSummary = summaryText !== '' && !/^(无|暂无|略|（无）|\(无\))$/.test(summaryText);
  const 摘要 = (hasSummary ? 截断(summaryText, 200) : '') || 截断(清洗(input.body), 160);
  if (!摘要) return null;

  return {
    id: `evt_${Math.max(0, Math.floor(input.turn))}_${input.now}`,
    回合: Math.max(0, Math.floor(input.turn)),
    时间: 清洗(input.worldTime ?? '') || undefined,
    地点: 清洗(input.location ?? '') || undefined,
    摘要,
    参与人: mapping.在场,
    亲见: mapping.亲见,
    被告知: mapping.被告知,
    不在场: mapping.不在场,
    背景在场: mapping.背景在场,
    公开度: mapping.公开度,
    来源: '正文',
    置信: '高',
    正文锚点: 截断(清洗(input.body), 400) || undefined,
    映射原文: 截断(mapping.原文, 600),
    创建时间: input.now,
  };
}

export function 封顶记忆事件(events: 记忆事件[], max: number = MEMORY_EVENT_MAX): 记忆事件[] {
  if (!Array.isArray(events) || events.length <= max) return events;
  return events.slice(-Math.max(1, max));
}

export function 归一化记忆事件(input: unknown, issues: string[]): 记忆事件[] {
  if (!Array.isArray(input)) {
    if (input !== undefined) issues.push('记忆事件不是数组，已置空。');
    return [];
  }
  const result: 记忆事件[] = [];
  const seen = new Set<string>();
  let invalidCount = 0;

  for (const raw of input) {
    if (!是普通对象(raw)) {
      invalidCount += 1;
      continue;
    }
    const id = 字符串(raw.id);
    const 摘要 = 字符串(raw.摘要).trim();
    if (!id || !摘要 || seen.has(id)) {
      invalidCount += 1;
      continue;
    }
    const 回合 = typeof raw.回合 === 'number' && Number.isFinite(raw.回合) ? Math.max(0, Math.floor(raw.回合)) : 0;
    seen.add(id);
    result.push({
      id,
      回合,
      时间: 可选字符串(raw.时间),
      地点: 可选字符串(raw.地点),
      摘要: 截断(摘要, 2000),
      参与人: 名字数组(raw.参与人),
      亲见: 名字数组(raw.亲见),
      被告知: 名字数组(raw.被告知),
      不在场: 名字数组(raw.不在场),
      背景在场: 名字数组(raw.背景在场),
      公开度: 公开度集合.has(raw.公开度 as 知情公开度) ? (raw.公开度 as 知情公开度) : '未知',
      来源: 来源集合.has(raw.来源 as 记忆事件来源) ? (raw.来源 as 记忆事件来源) : '导入',
      置信: 置信集合.has(raw.置信 as 记忆事件置信) ? (raw.置信 as 记忆事件置信) : '低',
      正文锚点: 可选字符串(raw.正文锚点),
      映射原文: 可选字符串(raw.映射原文),
      创建时间: typeof raw.创建时间 === 'number' && Number.isFinite(raw.创建时间) ? raw.创建时间 : Date.now(),
    });
  }

  if (invalidCount) issues.push(`记忆事件含 ${invalidCount} 条非法项，已清除。`);
  return 封顶记忆事件(result);
}

function 归一化公开度(raw: string): 知情公开度 {
  const text = raw.trim();
  if (text.includes('半公开')) return '半公开';
  if (text.includes('私密') || text.includes('秘密')) return '私密';
  if (text.includes('公开')) return '公开';
  return '未知';
}

function 拆名(raw: string): string[] {
  return raw
    .replace(/[（(][^）)]*[）)]/g, '')
    .split(/[、,，/／|]/)
    .map((name) => name.replace(/^[\s\-—*·]+|[\s。；;]+$/g, '').trim())
    .filter((name) => name.length > 0 && !无名项.has(name));
}

function 去重(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result.slice(0, 24);
}

function 名字数组(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return 去重(input.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean));
}

function 字符串(input: unknown): string {
  return typeof input === 'string' ? input : '';
}

function 可选字符串(input: unknown): string | undefined {
  const value = 字符串(input).trim();
  return value || undefined;
}

function 清洗(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function 截断(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function 是普通对象(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
