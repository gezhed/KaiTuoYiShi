import { useState } from 'react';
import {
  MEMORY_DRAFT_ITEM_CHAR_LIMIT,
  MEMORY_DRAFT_MAX_PENDING,
  MEMORY_DRAFT_MAX_TOTAL,
  MEMORY_DRAFT_TOTAL_CHAR_LIMIT,
  是待处理草稿,
  记忆压缩层级表,
  type 记忆失败草稿,
  type 记忆系统,
} from '@/models/memory';
import type { 记忆系统设置 } from '@/models/settings';
import {
  checkCompressionThreshold,
  checkMiddleTermThreshold,
  checkLongTermThreshold,
  compressToShortTerm,
  compressToMiddleTerm,
  compressToLongTerm,
} from '@/hooks/useGame/memoryUtils';
import { badgeClip as cardClip, smallClip } from '@/components/ui/clipPaths';
import type { 记忆事件 } from '@/models/memoryEvent';
import {
  从事件派生角色记忆,
  封顶角色记忆,
  type 角色记忆链接,
  type 角色记忆确信,
  type 角色记忆视角,
} from '@/models/characterMemory';

interface MemoryPanelProps {
  memorySystem: 记忆系统;
  onMemorySystemChange: React.Dispatch<React.SetStateAction<记忆系统>>;
  turnCount: number;
  settings: 记忆系统设置;
  /** 走独立工作流事务。 */
  onRetryFailedDraft?: (draftId: string) => void | Promise<void>;
  /** 仅归档草稿，不消费原始批次。 */
  onIgnoreFailedDraft?: (draftId: string) => void | Promise<void>;
}

type MemoryLayer = 'immediate' | 'short' | 'middle' | 'long' | 'failed' | 'events' | 'links';
type TextMemoryLayer = 'immediate' | 'short' | 'middle' | 'long';


const panelStyle = {
  background:
    'radial-gradient(circle at 10% 0%, rgba(var(--tj-tech-cyan), 0.075), transparent 34%), linear-gradient(180deg, rgba(var(--tj-bubble), 0.96), rgba(var(--tj-surface-strong), 0.94))',
  border: '1px solid rgba(var(--tj-border), var(--tj-edge))',
  clipPath: cardClip,
};

const layerMeta: Record<MemoryLayer, { label: string; subtitle: string; accent: string }> = {
  immediate: { label: '即时', subtitle: '最近几回合的原始记忆', accent: 'rgba(var(--tj-tech-blue),0.9)' },
  short: { label: '短期', subtitle: '已整理的事件摘要', accent: 'rgba(var(--tj-text-secondary), 0.9)' },
  middle: { label: '中期', subtitle: '阶段剧情链与未结事项', accent: 'rgba(var(--tj-ui-success),0.92)' },
  long: { label: '长期', subtitle: '不可忘却的稳定记忆', accent: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.96), rgba(var(--tj-accent-secondary),0.92))' },
  failed: { label: '失败草稿', subtitle: '总结失败后保留的原始批次', accent: 'rgba(var(--tj-danger),0.92)' },
  events: { label: '事件', subtitle: '每回合从知情映射登记的事件', accent: 'rgba(var(--tj-tech-cyan),0.92)' },
  links: { label: '角色记忆', subtitle: '事件 × 角色的视角与确信', accent: 'rgba(var(--tj-accent-secondary),0.92)' },
};

function getLayerTexts(memorySystem: 记忆系统, layer: TextMemoryLayer): string[] {
  switch (layer) {
    case 'immediate': return memorySystem.即时记忆;
    case 'short': return memorySystem.短期记忆;
    case 'middle': return memorySystem.中期记忆;
    case 'long': return memorySystem.长期记忆;
  }
}

function 待处理草稿数(memorySystem: 记忆系统): number {
  return memorySystem.失败草稿.filter(是待处理草稿).length;
}

export function MemoryPanel({
  memorySystem,
  onMemorySystemChange,
  turnCount,
  settings,
  onRetryFailedDraft,
  onIgnoreFailedDraft,
}: MemoryPanelProps) {
  const [activeLayer, setActiveLayer] = useState<MemoryLayer>('immediate');

  const isTextLayer = activeLayer === 'immediate' || activeLayer === 'short' || activeLayer === 'middle' || activeLayer === 'long';
  const visibleTextItems = isTextLayer ? getLayerTexts(memorySystem, activeLayer) : [];
  const events = memorySystem.事件 ?? [];
  const links = memorySystem.角色记忆 ?? [];
  const eventById = new Map(events.map((event) => [event.id, event]));

  const handleCompressShort = () => {
    const threshold = settings.即时转短期阈值;
    if (!checkCompressionThreshold(memorySystem, threshold)) {
      if (!confirm(`即时记忆不足 ${threshold} 条，仍要压缩当前累积内容到短期？`)) return;
    }
    onMemorySystemChange((prev) => {
      let next = prev;
      if (next.即时记忆.length > 0 && next.即时记忆.length < threshold) {
        return compressToShortTerm(next, turnCount, next.即时记忆.length);
      }
      while (next.即时记忆.length >= threshold) {
        next = compressToShortTerm(next, turnCount, threshold);
      }
      return next;
    });
  };

  const handleCompressMiddle = () => {
    const threshold = settings.短期转中期阈值 || 20;
    if (!checkMiddleTermThreshold(memorySystem, threshold)) {
      if (!confirm(`短期记忆不足 ${threshold} 条，仍要压缩当前累积内容到中期？`)) return;
    }
    onMemorySystemChange((prev) => {
      let next = prev;
      if (next.短期记忆.length > 0 && next.短期记忆.length < threshold) {
        return compressToMiddleTerm(next, turnCount, next.短期记忆.length);
      }
      while (next.短期记忆.length >= threshold) {
        next = compressToMiddleTerm(next, turnCount, threshold);
      }
      return next;
    });
  };

  const handleCompressLong = () => {
    const threshold = settings.中期转长期阈值 || 10;
    if (!checkLongTermThreshold(memorySystem, threshold)) {
      if (!confirm(`中期记忆不足 ${threshold} 条，仍要压缩当前累积内容到长期？`)) return;
    }
    onMemorySystemChange((prev) => {
      let next = prev;
      const middle = next.中期记忆;
      if (middle.length > 0 && middle.length < threshold) {
        return compressToLongTerm(next, turnCount, middle.length);
      }
      while (next.中期记忆.length >= threshold) {
        next = compressToLongTerm(next, turnCount, threshold);
      }
      return next;
    });
  };

  const selectedCount = activeLayer === 'failed'
    ? 待处理草稿数(memorySystem)
    : activeLayer === 'events'
      ? events.length
      : activeLayer === 'links'
        ? links.length
        : visibleTextItems.length;

  const handleDeleteEvent = (eventId: string) => {
    if (!confirm('删除这条事件？它对应的所有角色记忆也会一起删除，无法恢复。')) return;
    onMemorySystemChange((prev) => ({
      ...prev,
      事件: (prev.事件 ?? []).filter((event) => event.id !== eventId),
      角色记忆: (prev.角色记忆 ?? []).filter((link) => link.事件ID !== eventId),
    }));
  };

  const handleDeleteLink = (linkId: string) => {
    if (!confirm('删除这条角色记忆？只影响这个角色对事件的记忆，不删除事件本身。')) return;
    onMemorySystemChange((prev) => ({
      ...prev,
      角色记忆: (prev.角色记忆 ?? []).filter((link) => link.id !== linkId),
    }));
  };

  const handleUpdateLink = (linkId: string, patch: Partial<Pick<角色记忆链接, '视角' | '确信'>>) => {
    onMemorySystemChange((prev) => ({
      ...prev,
      角色记忆: (prev.角色记忆 ?? []).map((link) => (link.id === linkId ? { ...link, ...patch } : link)),
    }));
  };

  const handleBackfillLinks = () => {
    if (!events.length) return;
    if (!confirm('从现有事件补建角色记忆？只补充缺失的「事件 × 角色」链接，不覆盖已有记录。')) return;
    const existing = new Set(links.map((link) => `${link.事件ID}|${link.角色}`));
    const derived = events
      .flatMap((event) => 从事件派生角色记忆(event, []))
      .filter((link) => !existing.has(`${link.事件ID}|${link.角色}`));
    if (!derived.length) return;
    onMemorySystemChange((prev) => ({
      ...prev,
      角色记忆: 封顶角色记忆([...(prev.角色记忆 ?? []), ...derived]),
    }));
  };

  const recentEvents = [...events].reverse().slice(0, 100);
  const recentLinks = [...links]
    .map((link) => ({ link, event: eventById.get(link.事件ID) }))
    .filter((item): item is { link: 角色记忆链接; event: 记忆事件 } => Boolean(item.event))
    .sort((a, b) => b.event.回合 - a.event.回合)
    .slice(0, 100);

  return (
    <div className="flex min-h-full w-full min-w-0 flex-col gap-3 overflow-x-hidden md:h-full md:min-h-0 md:flex-row md:gap-4 md:overflow-hidden">
      <aside className="flex w-full min-w-0 shrink-0 flex-col gap-3 md:min-h-0 md:w-[260px]">
        <div className="px-4 py-4" style={panelStyle}>
          <SectionHeader title="记忆总览" />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MetricTile label="即时" value={`${memorySystem.即时记忆.length}`} />
            <MetricTile label="短期" value={`${memorySystem.短期记忆.length}`} />
            <MetricTile label="中期" value={`${memorySystem.中期记忆.length}`} />
            <MetricTile label="长期" value={`${memorySystem.长期记忆.length}`} />
            <MetricTile label="NPC" value={`${settings.NPC记忆压缩阈值} 条`} />
            <MetricTile label="失败草稿" value={`${待处理草稿数(memorySystem)}`} />
            <MetricTile label="事件" value={`${events.length}`} />
            <MetricTile label="角色记忆" value={`${links.length}`} />
          </div>
        </div>

        <div className="px-4 py-3" style={panelStyle}>
          <SectionHeader title="层级切换" />
          <div className="mt-3 grid gap-2 sm:grid-cols-3 md:grid-cols-1">
            {(Object.keys(layerMeta) as MemoryLayer[]).map((layer) => {
              const meta = layerMeta[layer];
              const active = activeLayer === layer;
              const count = layer === 'failed'
                ? 待处理草稿数(memorySystem)
                : layer === 'events'
                  ? events.length
                  : layer === 'links'
                    ? links.length
                    : getLayerTexts(memorySystem, layer).length;
              return (
                <button
                  key={layer}
                  type="button"
                  onClick={() => setActiveLayer(layer)}
                  className="w-full px-3 py-2.5 text-left transition-all hover:bg-[rgba(var(--tj-accent-primary),0.08)]"
                  style={{
                    background: active
                      ? 'linear-gradient(135deg, rgba(var(--tj-accent-primary), 0.16), rgba(var(--tj-accent-primary), 0.04))'
                      : 'rgba(var(--tj-text-secondary), 0.04)',
                    border: active
                      ? '1px solid transparent'
                      : '1px solid rgba(var(--tj-text-secondary), var(--tj-edge-tint))',
                    clipPath: smallClip,
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className="font-serif text-[13px] tracking-[0.2em]"
                      style={{ color: active ? 'rgb(var(--tj-accent-primary))' : 'rgba(var(--tj-text-secondary), 0.88)' }}
                    >
                      {meta.label}
                    </span>
                    <span
                      className="font-serif text-[12px]"
                      style={{ color: active ? 'rgb(var(--tj-text-primary))' : 'rgba(210, 198, 168, 0.8)' }}
                    >
                      {count}
                    </span>
                  </div>
                  <div
                    className="mt-1 truncate font-serif text-[11px]"
                    style={{ color: 'rgba(var(--tj-text-secondary), 0.74)' }}
                  >
                    {meta.subtitle}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <main className="min-h-0 w-full min-w-0 flex-1 overflow-visible pr-0 md:overflow-y-auto md:pr-1">
        <div className="min-h-full px-3 py-3 md:px-5 md:py-5" style={panelStyle}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <SectionHeader title="记忆条目" />
              <div className="mt-2 font-serif text-[14px] tracking-[0.18em]" style={{ color: layerMeta[activeLayer].accent }}>
                {layerMeta[activeLayer].label} · {selectedCount} 条
              </div>
              <div className="mt-1 font-serif text-[12px] tracking-[0.12em]" style={{ color: 'rgba(var(--tj-text-secondary), 0.78)' }}>
                {layerMeta[activeLayer].subtitle}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {activeLayer === 'immediate' && (
                <ActionButton onClick={handleCompressShort}>
                  压缩到短期
                </ActionButton>
              )}
              {activeLayer === 'short' && (
                <ActionButton onClick={handleCompressMiddle}>
                  压缩到中期
                </ActionButton>
              )}
              {activeLayer === 'middle' && (
                <ActionButton onClick={handleCompressLong}>
                  压缩到长期
                </ActionButton>
              )}
            </div>
          </div>

          <div className="mt-3 grid gap-2">
            {activeLayer === 'failed' ? (
              memorySystem.失败草稿.length === 0 ? (
                <EmptyNotice title="没有失败草稿" text="记忆总结失败时，原始批次会保留在这里，可重试或忽略。" />
              ) : (
                memorySystem.失败草稿.map((draft) => (
                  <MemoryDraftRow
                    key={draft.id}
                    draft={draft}
                    onRetry={onRetryFailedDraft}
                    onIgnore={onIgnoreFailedDraft}
                  />
                ))
              )
            ) : activeLayer === 'events' ? (
              recentEvents.length === 0 ? (
                <EmptyNotice title="还没有事件" text="每回合会从思维链的【知情映射】登记一条事件；若一直是空的，检查内置提示词模块是否启用。" />
              ) : (
                recentEvents.map((event) => (
                  <MemoryEventRow key={event.id} event={event} onDelete={handleDeleteEvent} />
                ))
              )
            ) : activeLayer === 'links' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-serif text-[11px] tracking-[0.16em]" style={{ color: 'rgba(var(--tj-text-secondary), 0.72)' }}>
                    最近 {recentLinks.length} 条
                  </span>
                  <ActionButton onClick={handleBackfillLinks}>从事件补建</ActionButton>
                </div>
                {recentLinks.length === 0 ? (
                  <EmptyNotice title="还没有角色记忆" text="事件登记后会自动派生角色视角；也可以在这里删除记错的条目，或用「从事件补建」回填旧存档。" />
                ) : (
                  recentLinks.map(({ link, event }) => (
                    <MemoryLinkRow key={link.id} link={link} event={event} onUpdate={handleUpdateLink} onDelete={handleDeleteLink} />
                  ))
                )}
              </div>
            ) : visibleTextItems.length === 0 ? (
              <EmptyNotice title="空" text="这一层目前没有内容。" />
            ) : (
              visibleTextItems.map((item, index) => (
                <MemoryRow key={`${activeLayer}-${index}-${item}`} index={index} text={item} />
              ))
            )}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3 md:grid-cols-1 xl:grid-cols-3">
            {activeLayer === 'failed' ? (
              <>
                <HintCard title="待处理上限" value={`${MEMORY_DRAFT_MAX_PENDING} 条`} text="超出后自动裁掉最旧的待处理草稿。" />
                <HintCard title="快照边界" value={`${MEMORY_DRAFT_ITEM_CHAR_LIMIT} / ${MEMORY_DRAFT_TOTAL_CHAR_LIMIT} 字`} text="单条与整批超界时不建草稿，直接用本地摘要。" />
                <HintCard title="归档上限" value={`${MEMORY_DRAFT_MAX_TOTAL} 条`} text="已归档与已忽略的草稿按最旧优先清理。" />
              </>
            ) : activeLayer === 'events' ? (
              <>
                <HintCard title="事件硬顶" value="500 条" text="超出后最旧事件会被淘汰，对应角色记忆同时剪裁。" />
                <HintCard title="来源" value="知情映射" text="每回合从思维链的【知情映射】登记；缺失时不建事件。" />
                <HintCard title="删除" value="不可恢复" text="删除事件会一并删除所有角色对它的记忆；改动在下一回合写档。" />
              </>
            ) : activeLayer === 'links' ? (
              <>
                <HintCard title="链接硬顶" value="2400 条" text="超出后最旧的链接会被裁掉。" />
                <HintCard title="视角" value="亲历 / 目击 / 被告知 / 背景" text="视角与确信度决定重要度和清晰度。" />
                <HintCard title="删除" value="只删这一条" text="删除记错的 link 不影响事件本身和其他角色；改动在下一回合写档。" />
              </>
            ) : (
              <>
                <HintCard title="即时阈值" value={`${settings.即时转短期阈值} 条`} text="达到后会自动压缩到短期。" />
                <HintCard title="短期阈值" value={`${settings.短期转中期阈值} 条`} text="达到后会自动压缩到中期。" />
                <HintCard title="中期阈值" value={`${settings.中期转长期阈值} 条`} text="达到后会自动压缩到长期。" />
                <HintCard title="NPC 阈值" value={`${settings.NPC记忆压缩阈值} 条`} text="伙伴的与你同行的记忆达到后会自动压缩。" />
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-4 w-[3px]" style={{ background: 'rgb(var(--tj-accent-primary))' }} />
      <span className="font-serif text-[13px] font-semibold tracking-[0.28em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
        {title}
      </span>
      <span className="h-px flex-1" style={{ background: 'linear-gradient(90deg, rgba(var(--tj-accent-primary),0.35), transparent)' }} />
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="px-3 py-2"
      style={{
        background: 'rgba(var(--tj-accent-primary), 0.055)',
        border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
        clipPath: smallClip,
      }}
    >
      <div className="font-serif text-[12px] tracking-[0.16em]" style={{ color: 'rgba(var(--tj-text-secondary), 0.82)' }}>
        {label}
      </div>
      <div className="mt-1 truncate font-serif text-[15px] font-semibold" style={{ color: 'rgb(var(--tj-text-primary))' }}>
        {value}
      </div>
    </div>
  );
}

function MemoryEventRow({ event, onDelete }: { event: 记忆事件; onDelete: (id: string) => void }) {
  const people = [
    event.参与人.length ? `参与：${event.参与人.join('、')}` : '',
    event.亲见.length ? `亲见：${event.亲见.join('、')}` : '',
    event.被告知.length ? `被告知：${event.被告知.join('、')}` : '',
    event.背景在场.length ? `背景在场：${event.背景在场.join('、')}` : '',
    event.不在场.length ? `不在场：${event.不在场.join('、')}` : '',
  ].filter(Boolean);
  return (
    <div
      className="px-3 py-3"
      style={{
        background: 'linear-gradient(135deg, rgba(var(--tj-bubble),0.84), rgba(var(--tj-surface-strong),0.56))',
        border: '1px solid rgba(var(--tj-border), var(--tj-edge-weak))',
        clipPath: smallClip,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-serif text-[11px] tracking-[0.16em]" style={{ color: 'rgba(var(--tj-tech-cyan), 0.9)' }}>
          第 {event.回合} 回合{event.时间 ? ` · ${event.时间}` : ''}{event.地点 ? ` · ${event.地点}` : ''} · {event.公开度}
        </div>
        <ActionButton onClick={() => onDelete(event.id)}>删除</ActionButton>
      </div>
      <div className="mt-1.5 whitespace-pre-wrap break-words font-serif text-[13px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-primary), 0.95)' }}>
        {event.摘要}
      </div>
      {people.length > 0 && (
        <div className="mt-1.5 font-serif text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.78)' }}>
          {people.join(' ｜ ')}
        </div>
      )}
      {event.正文锚点 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer font-serif text-[11px] tracking-[0.12em]" style={{ color: 'rgba(var(--tj-text-secondary), 0.72)' }}>
            正文锚点
          </summary>
          <div className="mt-1 whitespace-pre-wrap break-words font-serif text-[12px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.88)' }}>
            {event.正文锚点}
          </div>
        </details>
      )}
    </div>
  );
}

const 视角循环: 角色记忆视角[] = ['亲历', '目击', '被告知', '背景'];
const 确信循环: 角色记忆确信[] = ['确信', '模糊', '听说'];

function 下一个选项<T>(list: readonly T[], current: T): T {
  const index = list.indexOf(current);
  return list[(index + 1) % list.length] ?? current;
}

function MemoryLinkRow({
  link,
  event,
  onUpdate,
  onDelete,
}: {
  link: 角色记忆链接;
  event: 记忆事件;
  onUpdate: (id: string, patch: Partial<Pick<角色记忆链接, '视角' | '确信'>>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className="px-3 py-3"
      style={{
        background: 'linear-gradient(135deg, rgba(var(--tj-bubble),0.84), rgba(var(--tj-surface-strong),0.56))',
        border: '1px solid rgba(var(--tj-border), var(--tj-edge-weak))',
        clipPath: smallClip,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-serif text-[11px] tracking-[0.16em]" style={{ color: 'rgba(var(--tj-accent-secondary), 0.92)' }}>
          {link.角色} · 第 {event.回合} 回合 · {link.视角} · {link.确信}
          {link.情绪 ? ` · ${link.情绪}` : ''}{link.意义.length ? ` · ${link.意义.join('/')}` : ''}
        </div>
        <div className="flex items-center gap-1.5">
          <ActionButton onClick={() => onUpdate(link.id, { 视角: 下一个选项(视角循环, link.视角) })}>改视角</ActionButton>
          <ActionButton onClick={() => onUpdate(link.id, { 确信: 下一个选项(确信循环, link.确信) })}>改确信</ActionButton>
          <ActionButton onClick={() => onDelete(link.id)}>删除</ActionButton>
        </div>
      </div>
      <div className="mt-1.5 whitespace-pre-wrap break-words font-serif text-[12px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.92)' }}>
        {event.摘要}
      </div>
    </div>
  );
}

function MemoryRow({ index, text }: { index: number; text: string }) {
  return (
    <div
      className="px-3 py-3"
      style={{
        background: `linear-gradient(90deg, rgba(var(--tj-accent-primary), var(--tj-edge)) 0 2px, transparent 2px), linear-gradient(135deg, rgba(var(--tj-bubble),0.84), rgba(var(--tj-surface-strong),0.56))`,
        border: '1px solid rgba(var(--tj-border), var(--tj-edge-weak))',
        clipPath: smallClip,
      }}
    >
      <div className="font-serif text-[11px] tracking-[0.16em]" style={{ color: 'rgba(var(--tj-text-secondary), 0.72)' }}>
        #{index + 1}
      </div>
      <div className="mt-1 whitespace-pre-wrap break-words font-serif text-[13px] leading-relaxed tracking-[0.04em]" style={{ color: 'rgba(var(--tj-text-primary), 0.95)' }}>
        {text}
      </div>
    </div>
  );
}

const DRAFT_STATUS_META: Record<记忆失败草稿['status'], { label: string; color: string }> = {
  pending: { label: '待处理', color: 'rgba(var(--tj-danger), 0.92)' },
  retrying: { label: '重试中', color: 'rgba(var(--tj-accent-primary), 0.92)' },
  resolved: { label: '已归档', color: 'rgba(var(--tj-ui-success), 0.92)' },
  ignored: { label: '已忽略', color: 'rgba(var(--tj-text-secondary), 0.7)' },
};

function MemoryDraftRow({
  draft,
  onRetry,
  onIgnore,
}: {
  draft: 记忆失败草稿;
  onRetry?: (draftId: string) => void | Promise<void>;
  onIgnore?: (draftId: string) => void | Promise<void>;
}) {
  const retrying = draft.status === 'retrying';
  const actionable = 是待处理草稿(draft);
  const statusMeta = DRAFT_STATUS_META[draft.status];
  return (
    <div
      className="px-3 py-3"
      style={{
        background: `linear-gradient(90deg, rgba(var(--tj-danger), var(--tj-edge-strong)) 0 2px, transparent 2px), linear-gradient(135deg, rgba(var(--tj-bubble),0.84), rgba(var(--tj-surface-strong),0.56))`,
        border: '1px solid rgba(var(--tj-border), var(--tj-edge-weak))',
        clipPath: smallClip,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-serif text-[12px] tracking-[0.16em]" style={{ color: 'rgba(var(--tj-text-primary), 0.92)' }}>
          {记忆压缩层级表[draft.kind].标签} · 第 {draft.turn} 回合
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-serif text-[11px] tracking-[0.14em]" style={{ color: statusMeta.color }}>
            {statusMeta.label}
          </span>
          {actionable && (
            <>
              <ActionButton onClick={() => void onRetry?.(draft.id)} disabled={retrying}>
                {retrying ? '重试中…' : '重试'}
              </ActionButton>
              <ActionButton onClick={() => void onIgnore?.(draft.id)} disabled={retrying}>
                忽略
              </ActionButton>
            </>
          )}
        </div>
      </div>
      <div className="mt-1.5 whitespace-pre-wrap break-words font-serif text-[12px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.9)' }}>
        {draft.failureMessage || '记忆总结失败。'}
      </div>
      <div className="mt-1 font-serif text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.68)' }}>
        失败次数 {draft.attemptCount} · {new Date(draft.updatedAt).toLocaleString()}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer font-serif text-[11px] tracking-[0.12em]" style={{ color: 'rgba(var(--tj-text-secondary), 0.8)' }}>
          原始材料（{draft.items.length} 条）
        </summary>
        <div className="mt-2 grid gap-1.5">
          {draft.items.map((item, index) => (
            <div
              key={`${draft.id}-${index}`}
              className="whitespace-pre-wrap break-words px-2 py-1.5 font-serif text-[12px] leading-relaxed"
              style={{ background: 'rgba(var(--tj-text-secondary), 0.05)', color: 'rgba(var(--tj-text-primary), 0.88)', clipPath: smallClip }}
            >
              {index + 1}. {item}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function HintCard({ title, value, text }: { title: string; value: string; text: string }) {
  return (
    <div
      className="px-3 py-3"
      style={{
        background: 'rgba(var(--tj-accent-primary), 0.05)',
        border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))',
        clipPath: smallClip,
      }}
    >
      <div className="font-serif text-[12px] tracking-[0.18em]" style={{ color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.92), rgba(var(--tj-accent-secondary),0.88))' }}>
        {title}
      </div>
      <div className="mt-1 font-serif text-[14px] font-semibold" style={{ color: 'rgb(var(--tj-text-primary))' }}>
        {value}
      </div>
      <div className="mt-1 font-serif text-[12px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.78)' }}>
        {text}
      </div>
    </div>
  );
}

function EmptyNotice({ title, text }: { title: string; text: string }) {
  return (
    <div
      className="px-4 py-5 text-center"
      style={{
        background: 'rgba(var(--tj-text-secondary), 0.055)',
        border: '1px solid rgba(var(--tj-text-secondary), var(--tj-edge-tint))',
        clipPath: smallClip,
      }}
    >
      <div className="font-serif text-[15px] font-semibold tracking-[0.18em]" style={{ color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.94), rgba(var(--tj-accent-secondary),0.9))' }}>
        {title}
      </div>
      <div className="mt-2 font-serif text-[13px] leading-relaxed tracking-wider" style={{ color: 'rgba(var(--tj-text-secondary),0.82)' }}>
        {text}
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-serif text-[12px] tracking-[0.18em] px-3 py-1.5 transition-all hover:bg-[rgba(var(--tj-accent-primary),0.08)] disabled:opacity-50"
      style={{
        color: 'rgb(var(--tj-text-primary))',
        border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint-strong))',
        clipPath: smallClip,
      }}
    >
      {children}
    </button>
  );
}
