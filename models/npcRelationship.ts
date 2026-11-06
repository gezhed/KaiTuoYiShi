import { matchCanonical } from '@/data/canonicalCharacters';
import type { NPC记录 } from './npc';
import type { 智库条目 } from './zhiku';

export type NPC关系来源 = '资料库' | '玩家' | 'AI';

/** 关系推进的粗粒度阶段；具体称呼仍由 `关系` 自由描述。 */
export type NPC关系阶段 =
  | '陌生'
  | '认识'
  | '同行'
  | '熟识'
  | '亲近'
  | '挚友'
  | '亲密'
  | '敌对'
  | '复杂';

export const NPC关系阶段列表: NPC关系阶段[] = [
  '陌生',
  '认识',
  '同行',
  '熟识',
  '亲近',
  '挚友',
  '亲密',
  '敌对',
  '复杂',
];

/** 一条关系变更记录：谁在什么时候把关系从什么改成了什么。 */
export interface NPC关系变更 {
  回合: number;
  从?: string;
  到: string;
  原因?: string;
  来源?: NPC关系来源;
}

/** 一名 NPC 与其他角色的关系脉络（NPC ↔ NPC，不替代玩家 ↔ NPC 的好感度）。 */
export interface NPC关系脉络 {
  id: string;
  目标NPCID?: string;
  目标姓名: string;
  关系: string;
  阶段?: NPC关系阶段;
  说明?: string;
  来源?: NPC关系来源;
  最近更新回合?: number;
  变更记录?: NPC关系变更[];
}

export const NPC关系脉络硬顶 = 24;
export const NPC关系变更硬顶 = 12;

const 关系阶段集合 = new Set<NPC关系阶段>(NPC关系阶段列表);

export function 归一化关系阶段(value: unknown): NPC关系阶段 | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return 关系阶段集合.has(trimmed as NPC关系阶段) ? trimmed as NPC关系阶段 : undefined;
}

const 玩家称呼 = new Set([
  '开拓者',
  '星',
  '穹',
  '你',
  '玩家',
  '旅人',
  '主角',
  '他',
  '她',
]);

export function 规范化关系姓名(name: string): string {
  const canonical = matchCanonical(name);
  return (canonical?.name ?? name).replace(/[\s·・]/g, '').toLowerCase();
}

function 拆分别名(alias?: string): string[] {
  if (!alias) return [];
  return alias
    .split(/[、/／,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function 是同一角色(a: string, b: string): boolean {
  return 规范化关系姓名(a) === 规范化关系姓名(b);
}

function 是玩家称呼(name: string): boolean {
  if (玩家称呼.has(name)) return true;
  const canonical = matchCanonical(name);
  return Boolean(canonical && 玩家称呼.has(canonical.name));
}

function 提取关系段(text: string | undefined): string {
  if (!text) return '';
  const hit = text.match(/与他人关系（部分）\s*[:：]\s*([\s\S]*)$/);
  return hit?.[1]?.trim() ?? '';
}

function 拆分关系目标(raw: string): string[] {
  return raw
    .replace(/[*_`]/g, '')
    .replace(/（[^）]*）|\([^)]*\)/g, '')
    .split(/[、/／与]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 40);
}

function 取关系短语(description: string): string {
  const phrase = description.split(/[，,；;。]/)[0]?.trim() ?? '';
  return (phrase || '认识').slice(0, 24);
}

/** 从一条资料库文本里解析“与他人关系（部分）”下的 `名字：描述` 行。 */
export function 解析资料库关系段(
  text: string | undefined,
  ownerName: string,
): Array<Pick<NPC关系脉络, '目标姓名' | '关系' | '说明'>> {
  const section = 提取关系段(text);
  if (!section) return [];

  const rows: Array<{ target: string; description: string }> = [];
  let current: { target: string; description: string } | null = null;

  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s*·\-–—]+/, '').trim();
    if (!line) continue;
    if (/^(关系边界|注意|禁止|备注)[:：]/.test(line)) break;

    const hit = line.match(/^([^：:]{2,30})[：:]\s*(.+)$/);
    if (hit) {
      if (current) rows.push(current);
      current = { target: hit[1].trim(), description: hit[2].trim() };
    } else if (current) {
      current.description = `${current.description} ${line}`.trim();
    }
  }
  if (current) rows.push(current);

  const edges: Array<Pick<NPC关系脉络, '目标姓名' | '关系' | '说明'>> = [];
  for (const row of rows) {
    for (const target of 拆分关系目标(row.target)) {
      if (是玩家称呼(target)) continue;
      if (是同一角色(target, ownerName)) continue;
      edges.push({
        目标姓名: target,
        关系: 取关系短语(row.description),
        说明: row.description.slice(0, 160),
      });
    }
  }
  return edges;
}

/**
 * 从智库角色档案里提取“角色 → 其他角色”的关系图。
 * 键是角色本名（能匹配原著角色时用原著名），值是资料库里已有的关系边。
 */
export function 提取资料库关系网(
  entries: 智库条目[] | undefined,
): Map<string, NPC关系脉络[]> {
  const graph = new Map<string, NPC关系脉络[]>();
  if (!entries?.length) return graph;

  for (const entry of entries) {
    if (entry.分类 !== 'character') continue;
    const ownerName = entry.标题.trim();
    if (!ownerName || 是玩家称呼(ownerName)) continue;

    const ownerKey = matchCanonical(ownerName)?.name ?? ownerName;
    const seen = new Map<string, NPC关系脉络>();
    const characterInjection = entry.注入内容?.类型 === 'character' ? entry.注入内容 : undefined;
    const texts = [entry.关系边界, characterInjection?.演绎红线];
    for (const text of texts) {
      for (const edge of 解析资料库关系段(text, ownerName)) {
        const key = 规范化关系姓名(edge.目标姓名);
        if (seen.has(key)) continue;
        seen.set(key, {
          id: `rel-${ownerKey}-${seen.size}-${key}`,
          目标姓名: edge.目标姓名,
          关系: edge.关系,
          说明: edge.说明,
          来源: '资料库',
        });
      }
    }
    if (!seen.size) continue;
    const current = graph.get(ownerKey) ?? [];
    graph.set(ownerKey, 合并NPC关系脉络(current, [...seen.values()]));
  }
  return graph;
}

/** 合并两组关系脉络；玩家/AI 写入的边优先，资料库只补缺。 */
export function 合并NPC关系脉络(
  base: NPC关系脉络[] | undefined,
  incoming: NPC关系脉络[] | undefined,
): NPC关系脉络[] {
  const merged = new Map<string, NPC关系脉络>();
  for (const edge of [...(base ?? []), ...(incoming ?? [])]) {
    const name = edge.目标姓名.trim();
    if (!name) continue;
    const key = edge.目标NPCID || 规范化关系姓名(name);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...edge, 目标姓名: name });
      continue;
    }
    const combinedChanges = 合并关系变更记录(current.变更记录, edge.变更记录);
    const combinedTurn = Math.max(current.最近更新回合 ?? 0, edge.最近更新回合 ?? 0) || undefined;
    if (current.来源 === '玩家' || current.来源 === 'AI') {
      merged.set(key, { ...current, 变更记录: combinedChanges, 最近更新回合: combinedTurn });
      continue;
    }
    if (edge.来源 === '玩家' || edge.来源 === 'AI') {
      merged.set(key, { ...edge, 目标姓名: name, id: current.id, 变更记录: combinedChanges, 最近更新回合: combinedTurn });
      continue;
    }
    const currentLength = current.说明?.length ?? 0;
    const edgeLength = edge.说明?.length ?? 0;
    if (edgeLength > currentLength) {
      merged.set(key, { ...edge, 目标姓名: name, id: current.id, 变更记录: combinedChanges, 最近更新回合: combinedTurn });
    } else {
      merged.set(key, { ...current, 变更记录: combinedChanges, 最近更新回合: combinedTurn });
    }
  }
  return [...merged.values()].slice(0, NPC关系脉络硬顶);
}

function 归一化关系变更记录(input: unknown): NPC关系变更[] {
  if (!Array.isArray(input)) return [];
  const result: NPC关系变更[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    const 回合 = typeof raw.回合 === 'number' && Number.isFinite(raw.回合) ? Math.max(0, Math.floor(raw.回合)) : 0;
    const rawTo = raw.到 ?? raw.to ?? raw.关系;
    const 到 = typeof rawTo === 'string' ? rawTo.trim().slice(0, 80) : '';
    if (!到) continue;
    const rawFrom = raw.从 ?? raw.from;
    const 从 = typeof rawFrom === 'string' ? rawFrom.trim().slice(0, 80) : undefined;
    const rawReason = raw.原因 ?? raw.reason;
    const 原因 = typeof rawReason === 'string' ? rawReason.trim().slice(0, 120) : undefined;
    const rawSource = raw.来源 ?? raw.source;
    const 来源: NPC关系来源 | undefined = rawSource === '玩家' || rawSource === 'AI' || rawSource === '资料库'
      ? rawSource
      : undefined;
    result.push({ 回合, 从, 到, 原因, 来源 });
  }
  return 合并关系变更记录([], result);
}

function 合并关系变更记录(
  a: NPC关系变更[] | undefined,
  b: NPC关系变更[] | undefined,
): NPC关系变更[] {
  const merged = new Map<string, NPC关系变更>();
  for (const item of [...(a ?? []), ...(b ?? [])]) {
    const key = `${item.回合}|${item.从 ?? ''}|${item.到}|${item.原因 ?? ''}`;
    merged.set(key, item);
  }
  return [...merged.values()]
    .sort((left, right) => left.回合 - right.回合)
    .slice(-NPC关系变更硬顶);
}

/**
 * 新增或更新一条 NPC ↔ NPC 关系；关系/阶段变化时自动写入变更记录。
 * 玩家手动编辑和 AI 的 `npc_relation` 事实都走这里，保证历史一致。
 */
export function 更新NPC关系脉络(
  edges: NPC关系脉络[] | undefined,
  input: {
    目标姓名: string;
    关系?: string;
    阶段?: NPC关系阶段;
    说明?: string;
    回合: number;
    原因?: string;
    来源?: NPC关系来源;
    目标NPCID?: string;
  },
): NPC关系脉络[] {
  const list = [...(edges ?? [])];
  const name = input.目标姓名.trim();
  if (!name) return list;
  const key = input.目标NPCID || 规范化关系姓名(name);
  const index = list.findIndex((edge) => (
    (input.目标NPCID && edge.目标NPCID === input.目标NPCID)
    || 规范化关系姓名(edge.目标姓名) === 规范化关系姓名(name)
  ));
  const 回合 = Math.max(0, Math.floor(input.回合));
  if (index < 0) {
    const relation = input.关系?.trim() || input.阶段 || '认识';
    list.push({
      id: `rel-${回合}-${key}`,
      目标NPCID: input.目标NPCID,
      目标姓名: name,
      关系: relation,
      阶段: input.阶段,
      说明: input.说明?.trim() || undefined,
      来源: input.来源 ?? '玩家',
      最近更新回合: 回合,
      变更记录: [{ 回合, 到: relation, 原因: input.原因, 来源: input.来源 ?? '玩家' }],
    });
    return list.slice(0, NPC关系脉络硬顶);
  }

  const current = list[index];
  const relation = input.关系?.trim() || current.关系;
  const stage = input.阶段 ?? current.阶段;
  const changed = relation !== current.关系 || stage !== current.阶段;
  const changes = changed
    ? 合并关系变更记录(current.变更记录, [{
      回合,
      从: current.关系,
      到: relation,
      原因: input.原因,
      来源: input.来源 ?? '玩家',
    }])
    : current.变更记录;
  list[index] = {
    ...current,
    关系: relation,
    阶段: stage,
    说明: input.说明?.trim() || current.说明,
    来源: input.来源 ?? current.来源,
    最近更新回合: 回合,
    变更记录: changes ?? [],
  };
  return list.slice(0, NPC关系脉络硬顶);
}

/** 归一化存档里的关系脉络；兼容少量字段别名和旧存档。 */
export function 归一化NPC关系脉络(
  input: unknown,
  selfNames: string[] = [],
  issues?: string[],
): NPC关系脉络[] {
  if (!Array.isArray(input)) return [];
  const merged = new Map<string, NPC关系脉络>();
  let invalidCount = 0;

  input.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      invalidCount += 1;
      return;
    }
    const source = item as Record<string, unknown>;
    const rawName = source.目标姓名 ?? source.姓名 ?? source.name ?? source.target;
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name || name.length > 40) {
      invalidCount += 1;
      return;
    }
    if (selfNames.some((selfName) => 是同一角色(name, selfName))) {
      invalidCount += 1;
      return;
    }
    const rawRelation = source.关系 ?? source.relation ?? source.label;
    const rawDescription = source.说明 ?? source.description ?? source.note ?? source.desc;
    const rawTargetId = source.目标NPCID ?? source.targetNpcId ?? source.targetNpcID;
    const rawSource = source.来源 ?? source.source;
    const rawStage = source.阶段 ?? source.stage;
    const rawUpdatedAt = source.最近更新回合 ?? source.updatedAtTurn;
    const rawChanges = source.变更记录 ?? source.changes;
    const relation = typeof rawRelation === 'string' && rawRelation.trim()
      ? rawRelation.trim().slice(0, 24)
      : '认识';
    const description = typeof rawDescription === 'string' ? rawDescription.trim().slice(0, 200) : undefined;
    const targetId = typeof rawTargetId === 'string' && rawTargetId.trim() ? rawTargetId.trim() : undefined;
    const origin: NPC关系来源 = rawSource === '玩家' || rawSource === 'AI' ? rawSource : '资料库';
    const stage = 归一化关系阶段(rawStage);
    const updatedAtTurn = typeof rawUpdatedAt === 'number' && Number.isFinite(rawUpdatedAt)
      ? Math.max(0, Math.floor(rawUpdatedAt))
      : undefined;
    const key = targetId || 规范化关系姓名(name);
    if (merged.has(key)) return;
    merged.set(key, {
      id: typeof source.id === 'string' && source.id.trim() ? source.id : `rel-${index}-${key}`,
      目标NPCID: targetId,
      目标姓名: name,
      关系: relation,
      阶段: stage,
      说明: description,
      来源: origin,
      最近更新回合: updatedAtTurn,
      变更记录: 归一化关系变更记录(rawChanges),
    });
  });

  if (invalidCount > 0 && issues) issues.push(`已忽略 ${invalidCount} 条无效的角色关系脉络。`);
  return [...merged.values()].slice(0, NPC关系脉络硬顶);
}

function 收集记录身份键(record: NPC记录): string[] {
  const names = [record.姓名, ...拆分别名(record.别名)]
    .map((name) => name.trim())
    .filter(Boolean);
  const keys = new Set<string>();
  for (const name of names) {
    keys.add(name);
    const canonical = matchCanonical(name);
    if (canonical) keys.add(canonical.name);
  }
  return [...keys];
}

function 查找记录(records: NPC记录[], name: string): NPC记录 | undefined {
  const key = 规范化关系姓名(name);
  return records.find((record) =>
    收集记录身份键(record).some((identity) => 规范化关系姓名(identity) === key),
  );
}

/**
 * 给还没有补种过的 NPC 写入资料库关系网。
 * - 新局在创建初始 NPC 时调用一次，正式开场前关系网就已存在。
 * - 旧档可在 stage1 调用，下一回合写档。
 * - `force` 用于“从资料库补齐关系网”按钮，保留玩家手改边。
 */
export function 补种NPC关系网(
  records: NPC记录[],
  entries: 智库条目[] | undefined,
  options: { force?: boolean } = {},
): NPC记录[] {
  const graph = 提取资料库关系网(entries);
  if (!graph.size) return records;

  const seeded = records.map((record) => {
    if (record.关系网已补种 && !options.force) return record;
    const edges = 收集记录身份键(record).flatMap((key) => graph.get(key) ?? []);
    const next = 合并NPC关系脉络(
      record.关系脉络 ?? [],
      edges.filter((edge) => !收集记录身份键(record).some((identity) => 是同一角色(identity, edge.目标姓名))),
    );
    return { ...record, 关系脉络: next, 关系网已补种: true };
  });

  const changed = seeded.some((record, index) => record !== records[index]);
  if (!changed) return records;

  return seeded.map((record) => ({
    ...record,
    关系脉络: (record.关系脉络 ?? []).map((edge) => {
      const target = 查找记录(seeded, edge.目标姓名);
      if (!target || target.id === record.id) return edge;
      return { ...edge, 目标NPCID: target.id };
    }),
  }));
}
