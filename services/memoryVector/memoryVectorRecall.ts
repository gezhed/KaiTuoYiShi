/**
 * 记忆事件向量召回：Phase 0 事件的补充检索通道。
 *
 * 关键词/实体仍是主路径；这里只回答“同义改写、代称、跨回合复述”这类
 * 字面命中不了的回忆。模型在浏览器本地跑，向量可重建，不进存档。
 */
import { MEMORY_EVENT_MAX, type 记忆事件 } from '@/models/memoryEvent';
import type { 记忆系统设置 } from '@/models/settings';
import { embedMemoryTexts, getMemoryEmbeddingStatus, warmupMemoryEmbedding } from './embeddingClient';
import { loadVectorCache, saveVectorCache } from './vectorCache';
import { cosineSimilarity, hashText } from './vectorMath';
import { formatMemoryEventLabel } from './format';

/** 全部记忆事件（受 500 条硬顶约束）都建索引；更早的由分层记忆/忆庭承接。 */
export const MEMORY_VECTOR_INDEX_LIMIT = MEMORY_EVENT_MAX;
/** 单回合最多补算多少条缺失向量，避免第一回合卡太久。 */
export const MEMORY_VECTOR_EMBED_BATCH = 32;

export interface MemoryVectorHit {
  event: 记忆事件;
  score: number;
}

export type MemoryVectorRecallStatus = 'disabled' | 'empty' | 'warming' | 'ok' | 'timeout' | 'error';

export interface MemoryVectorRecallResult {
  enabled: boolean;
  status: MemoryVectorRecallStatus;
  model: string;
  indexed: number;
  hits: MemoryVectorHit[];
  injection: string;
  message: string;
}

export function buildMemoryEventEmbeddingText(event: 记忆事件): string {
  const label = formatMemoryEventLabel(event);
  const parts = [label, event.摘要, event.正文锚点 ?? ''].filter((part) => part.trim());
  return parts.join('\n').slice(0, 600);
}

export function selectVectorHits(
  events: 记忆事件[],
  vectors: Map<string, Float32Array>,
  queryVector: Float32Array,
  topK: number,
  minScore: number,
): MemoryVectorHit[] {
  const hits: MemoryVectorHit[] = [];
  for (const event of events) {
    const vector = vectors.get(event.id);
    if (!vector) continue;
    const score = cosineSimilarity(queryVector, vector);
    if (!Number.isFinite(score) || score < minScore) continue;
    hits.push({ event, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, Math.max(0, topK));
}

export function buildMemoryRecallInjection(hits: MemoryVectorHit[], budget: number): string {
  if (!hits.length) return '';
  const limit = Math.max(120, budget);
  const lines: string[] = [];
  let used = 0;
  for (const hit of hits) {
    const head = `- 【回合${hit.event.回合}】${formatMemoryEventLabel(hit.event)}`;
    const body = hit.event.摘要.trim();
    const anchor = hit.event.正文锚点?.trim() ?? '';
    const entry = [head, body, anchor && anchor !== body ? `  证据：${anchor}` : ''].filter(Boolean).join('\n');
    if (used + entry.length > limit) {
      const room = limit - used - head.length - 2;
      if (room > 40) {
        lines.push(`${head}\n${body.slice(0, room)}`);
      }
      break;
    }
    lines.push(entry);
    used += entry.length;
  }
  return lines.join('\n');
}

export async function recallMemoryEvents(input: {
  events: 记忆事件[];
  query: string;
  settings: 记忆系统设置 | undefined;
  signal?: AbortSignal;
}): Promise<MemoryVectorRecallResult> {
  const { events, query, settings, signal } = input;
  if (!settings) {
    return { enabled: false, status: 'disabled', model: '', indexed: 0, hits: [], injection: '', message: '记忆系统设置未加载' };
  }
  const model = settings.向量召回模型.trim() || 'Xenova/bge-small-zh-v1.5';
  const host = settings.向量召回模型源.trim();
  const enabled = settings.向量召回启用;
  const recent = events.slice(-MEMORY_VECTOR_INDEX_LIMIT);

  if (!enabled) {
    return { enabled: false, status: 'disabled', model, indexed: 0, hits: [], injection: '', message: '向量召回已关闭' };
  }
  if (!recent.length || !query.trim()) {
    return { enabled: true, status: 'empty', model, indexed: 0, hits: [], injection: '', message: '没有可检索的记忆事件' };
  }

  const state = getMemoryEmbeddingStatus();
  if (state.status !== 'ready' || state.model !== model) {
    warmupMemoryEmbedding(model, host);
    return { enabled: true, status: 'warming', model, indexed: 0, hits: [], injection: '', message: '本地向量模型正在加载，本回合先走关键词召回' };
  }

  try {
    const texts = recent.map(buildMemoryEventEmbeddingText);
    const hashes = texts.map(hashText);
    const cached = await loadVectorCache(model, hashes);
    const missingIdx: number[] = [];
    for (let i = 0; i < hashes.length; i += 1) {
      if (!cached.has(hashes[i])) missingIdx.push(i);
    }
    const batch = missingIdx.slice(0, MEMORY_VECTOR_EMBED_BATCH);

    const requestTexts = [query, ...batch.map((index) => texts[index])];
    const embedded = await embedMemoryTexts(model, requestTexts, { signal, host });
    if (embedded.vectors.length !== requestTexts.length) {
      throw new Error('本地向量模型返回数量不符。');
    }

    const [queryVector, ...eventVectors] = embedded.vectors;
    const fresh: Array<{ hash: string; vector: Float32Array; dim: number }> = [];
    batch.forEach((index, position) => {
      const vector = eventVectors[position];
      cached.set(hashes[index], vector);
      fresh.push({ hash: hashes[index], vector, dim: vector.length });
    });
    await saveVectorCache(model, fresh);

    const hits = selectVectorHits(
      recent,
      (() => {
        const vectors = new Map<string, Float32Array>();
        recent.forEach((event, index) => {
          const vector = cached.get(hashes[index]);
          if (vector) vectors.set(event.id, vector);
        });
        return vectors;
      })(),
      queryVector,
      settings.向量召回TopK,
      settings.向量召回最低相似度,
    );
    const injection = buildMemoryRecallInjection(hits, settings.向量召回注入字数);
    return {
      enabled: true,
      status: 'ok',
      model,
      indexed: cached.size,
      hits,
      injection,
      message: hits.length ? `向量召回 ${hits.length} 条` : '向量召回无命中',
    };
  } catch (error) {
    if (signal?.aborted) {
      return { enabled: true, status: 'timeout', model, indexed: 0, hits: [], injection: '', message: '向量召回被取消' };
    }
    return {
      enabled: true,
      status: 'error',
      model,
      indexed: 0,
      hits: [],
      injection: '',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
