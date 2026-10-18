import type { 聊天消息, 叙事插图 } from '@/models/chat';
import type { 相册系统 } from '@/models/imageGeneration';
import { 解析相册资源引用 } from '@/utils/albumActions';

export interface 丢失缓存插图 {
  messageId: string;
  插图: 叙事插图;
  /** 在消息 narrativeImages 里的位置；自动重画按位置回收结果。 */
  序号: number;
}

/**
 * 找出当前显示对话里「状态是 done，但图片地址已经解析不出来」的插图。
 *
 * 只认 `asset:` / 空地址这类缓存引用；`static:` 资源缺失属于资源包问题，
 * 不在这里自动重画，避免把静态立绘当成生成图重刷。
 */
export function 找出丢失缓存插图(
  messages: readonly 聊天消息[],
  album: 相册系统 | undefined,
): 丢失缓存插图[] {
  const missing: 丢失缓存插图[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const images = message.narrativeImages ?? [];
    images.forEach((插图, 序号) => {
      if (插图.status !== 'done') return;
      const raw = 插图.dataUrl.trim() || (插图.assetId ? `asset:${插图.assetId}` : '');
      if (!raw) {
        missing.push({ messageId: message.id, 插图, 序号 });
        return;
      }
      if (raw.startsWith('static:')) return;
      if (解析相册资源引用(album, raw)) return;
      missing.push({ messageId: message.id, 插图, 序号 });
    });
  }
  return missing;
}
