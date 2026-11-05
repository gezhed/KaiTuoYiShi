/**
 * 记忆向量召回的最小数学工具。
 *
 * 向量只作“补充召回信号”：关键词/实体检索仍是主路径，余弦相似度用来把
 * 同义改写、代称、跨回合复述的回忆捞回来。所有向量都可由原文重建，
 * 因此不进入存档，只放在浏览器派生缓存里。
 */

/** 稳定、同步的文本指纹；用于向量缓存键，不用于安全用途。 */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
    h2 ^= h2 >>> 13;
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

/** 余弦相似度；维度不一致或空向量返回 0。 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function isFloat32Array(value: unknown): value is Float32Array {
  return value instanceof Float32Array;
}
