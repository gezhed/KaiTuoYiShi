import type { 记忆事件 } from '@/models/memoryEvent';

/** 事件的时间地点标签；两者都没有时返回空串。 */
export function formatMemoryEventLabel(event: 记忆事件): string {
  return [event.时间?.trim(), event.地点?.trim()].filter(Boolean).join('｜');
}
