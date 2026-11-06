import type { API配置项 } from '@/models/settings';
import type { NPC记录 } from '@/models/npc';
import type { 朋友圈生成上下文, 朋友圈生成条目 } from '@/models/moments';
import { chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import {
  extractJsonLikeText,
  normalizeStructuredModelText,
  parseJsonWithRepair,
} from '@/services/ai/structuredOutputRepair';

/** 朋友圈只写生活切片，不推进主线；模型只看到作者与最近动态，避免全知。 */
function buildMomentsSystemPrompt(): string {
  return [
    '你是《崩坏：星穹铁道》同人角色扮演游戏里的“朋友圈”内容生成器。',
    '你的任务：为指定的几名角色各写一条朋友圈动态，表现他们在主线之外的生活、情绪、关系和日常。',
    '',
    '硬规则：',
    '1. 只写给出的作者，不要新增角色，不要替玩家发动态。',
    '2. 每条 40~120 字，第一人称或第三人称均可，但必须像角色本人在社交媒体上说话。',
    '3. 内容可以是：日常琐事、对伙伴的吐槽、旅途见闻、心情、收藏、吃喝、训练、工作、对某人的在意。',
    '4. 不推进主线，不宣布重大剧情转折，不写“接下来我们要去…”。',
    '5. 不写系统提示、不写“作为AI”、不解释设定；不要 @ 任何人。',
    '6. 同一批动态之间不要互相复读；最近发过的内容不要再发。',
    '7. 可以带“配图”字段，写一句 15~60 字的画面描述（如“窗边的咖啡和摊开的书”）。系统可能据此生成一张生活照，不要写文字、水印、边框或 URL。',
    '',
    '只输出 JSON 数组，不要 Markdown 代码块：',
    '[{"作者":"角色名","内容":"动态正文","配图":"可选画面描述"}]',
  ].join('\n');
}

function buildAuthorBlock(ctx: 朋友圈生成上下文): string {
  return ctx.authors
    .map((npc) => {
      const lines = [`### ${npc.姓名}`];
      if (npc.别名) lines.push(`别名：${npc.别名}`);
      if (npc.关系.trim()) lines.push(`与玩家关系：${npc.关系}`);
      if (npc.亲密关系) lines.push(`亲密关系：${npc.亲密关系}`);
      if (npc.最近互动) lines.push(`最近互动：${npc.最近互动}`);
      const 同行记忆 = npc.同行记忆 ?? [];
      if (同行记忆.length) {
        const last = 同行记忆[同行记忆.length - 1];
        if (last.摘要) lines.push(`最近共同经历：${last.摘要}`);
      }
      const edges = (npc.关系脉络 ?? [])
        .slice(0, 6)
        .map((edge) => `${edge.目标姓名}（${edge.关系 || edge.阶段 || '认识'}）`);
      if (edges.length) lines.push(`在意的人：${edges.join('、')}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

function buildRecentBlock(ctx: 朋友圈生成上下文): string {
  const recent = ctx.recentPosts.slice(-6);
  if (!recent.length) return '（最近没有动态）';
  return recent
    .map((post) => `- ${post.作者姓名}：${post.内容.slice(0, 80)}`)
    .join('\n');
}

export function buildMomentsUserPrompt(ctx: 朋友圈生成上下文): string {
  return [
    `当前回合：第${ctx.turn}回合`,
    ctx.location ? `当前地点：${ctx.location}` : '',
    ctx.time ? `当前时间：${ctx.time}` : '',
    `玩家：${ctx.travelerName}`,
    '',
    '# 本批作者',
    buildAuthorBlock(ctx),
    '',
    '# 最近动态（避免重复）',
    buildRecentBlock(ctx),
    '',
    '请为以上每位作者各写一条朋友圈，输出 JSON 数组。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function parseMomentsResponse(raw: string, authors: NPC记录[]): 朋友圈生成条目[] {
  const normalized = normalizeStructuredModelText(raw);
  const jsonText = extractJsonLikeText(normalized, 'any');
  const parsed = parseJsonWithRepair(jsonText, 'any');
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { posts?: unknown }).posts)
      ? (parsed as { posts: unknown[] }).posts
      : [];
  const byName = new Map<string, NPC记录>();
  for (const npc of authors) {
    for (const name of [npc.姓名, npc.别名].filter((item): item is string => Boolean(item?.trim()))) {
      byName.set(name.trim().replace(/\s+/g, '').toLowerCase(), npc);
    }
  }
  const seen = new Set<string>();
  const result: 朋友圈生成条目[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const authorName = typeof record.作者 === 'string' ? record.作者.trim() : '';
    const content = typeof record.内容 === 'string' ? record.内容.trim() : '';
    if (!authorName || !content) continue;
    const npc = byName.get(authorName.replace(/\s+/g, '').toLowerCase());
    if (!npc || seen.has(npc.id)) continue;
    seen.add(npc.id);
    result.push({
      作者: npc.姓名,
      内容: content.slice(0, 500),
      配图: typeof record.配图 === 'string' && record.配图.trim() ? record.配图.trim().slice(0, 120) : undefined,
    });
  }
  return result;
}

export async function generateMoments(
  config: API配置项,
  ctx: 朋友圈生成上下文,
  signal?: AbortSignal,
): Promise<朋友圈生成条目[]> {
  const raw = await chatCompletionNonStream(config, {
    systemPrompt: buildMomentsSystemPrompt(),
    messages: [{ role: 'user', content: buildMomentsUserPrompt(ctx) }],
    maxTokens: 1600,
    temperature: 0.9,
    signal,
  });
  return parseMomentsResponse(raw, ctx.authors);
}
