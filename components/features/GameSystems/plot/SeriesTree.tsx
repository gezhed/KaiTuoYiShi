import type { 剧情编织分段, 剧情编织系列, 剧情编织系统 } from '@/models/storyWeaving';
import { cardClip, runtimeStatusBg, runtimeStatusColor, smallClip, statusBg, statusColor } from './constants';

export function SeriesTree({
  system,
  viewSeries,
  selectedSegmentId,
  expandedSeriesId,
  busyId,
  searchQuery = '',
  onSelectSeries,
  onSelectSegment,
  onSelectChapter,
}: {
  system: 剧情编织系统;
  viewSeries: 剧情编织系列;
  selectedSegmentId: string | null;
  expandedSeriesId: string | null;
  busyId: string | null;
  searchQuery?: string;
  onSelectSeries: (series: 剧情编织系列) => void;
  onSelectSegment: (segment: 剧情编织分段) => void;
  onSelectChapter: (series: 剧情编织系列, chapterSeq: number) => void;
}) {
  const query = searchQuery.trim();
  const chapterMatches = (title: string) => !query || title.includes(query);
  const segmentMatches = (segment: 剧情编织分段) => !query || [
    segment.标题,
    segment.章节范围,
    segment.剧情地区 ?? '',
    ...segment.章节标题,
    ...segment.登场角色,
    ...segment.涉及地点,
    segment.本段概括.slice(0, 160),
    segment.原文摘要,
  ].join('\n').includes(query);
  return (
    <aside className="kaituo-options-scroll overflow-visible pb-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1 lg:pb-3">
      <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
        {system.系列列表.map((series) => {
          const active = series.id === viewSeries.id;
          const expanded = expandedSeriesId === series.id;
          const completeCount = series.分段列表.filter((item) => item.处理状态 === '已完成').length;
          const visibleChapters = series.章节列表.filter((chapter) => chapterMatches(chapter.标题));
          const visibleSegments = series.分段列表.filter(segmentMatches);
          const matchedCount = visibleSegments.length;
          return (
            <div key={series.id} className="w-[78vw] max-w-[280px] shrink-0 lg:w-auto lg:max-w-none" style={{ border: `1px solid ${active ? 'rgba(var(--tj-accent-primary), var(--tj-edge-tint-strong))' : 'rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))'}`, background: active ? 'rgba(var(--tj-accent-primary),0.055)' : 'rgba(var(--tj-bg-primary),0.42)', clipPath: cardClip }}>
              <button className="w-full px-3 py-2 text-left" onClick={() => onSelectSeries(series)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-serif text-xs font-bold" style={{ color: active ? 'rgb(var(--tj-accent-primary))' : 'rgba(var(--tj-text-secondary),0.86)' }}>{series.标题}</span>
                  <span className="text-[11px]" style={{ color: series.激活注入 ? 'rgba(145,210,175,0.9)' : 'rgba(var(--tj-text-secondary),0.7)' }}>{series.激活注入 ? 'ON' : 'OFF'}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary),0.75)' }}>
                  <span>{series.剧情分类 ?? (series.来源类型 === 'canon' ? (/(^|_)side_|【支线】|支线/.test(`${series.id}\n${series.标题}`) ? '支线' : '主线') : '其他')}</span>
                  {series.剧情地区 && series.剧情地区 !== '多地区' && <span>· {series.剧情地区}</span>}
                  {series.剧情版本 && <span>· v{series.剧情版本}</span>}
                  <span>· {series.章节列表.length} 章 · {completeCount}/{series.分段列表.length} 段</span>
                </div>
              </button>

              {expanded && (
                <div className="space-y-2 px-2 pb-2">
                  <div>
                    <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-serif tracking-[0.18em]" style={{ color: 'rgba(var(--tj-accent-primary),0.6)' }}>
                      <span>章节</span>
                      {query && <span style={{ color: 'rgba(var(--tj-tech-cyan),0.8)' }}>匹配 {visibleChapters.length}/{series.章节列表.length}</span>}
                    </div>
                    <div className="kaituo-options-scroll max-h-28 space-y-1 overflow-y-auto pr-1">
                      {visibleChapters.map((chapter) => (
                        <button
                          key={chapter.id}
                          className="w-full truncate px-2 py-1 text-left text-[11px]"
                          style={{ color: 'rgba(var(--tj-text-secondary),0.78)', background: 'rgba(var(--tj-accent-primary),0.035)', clipPath: smallClip }}
                          onClick={() => onSelectChapter(series, chapter.序号)}
                        >
                          {chapter.序号}. {chapter.标题}
                        </button>
                      ))}
                      {visibleChapters.length === 0 && <div className="px-2 py-1 text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary),0.6)' }}>无匹配章节</div>}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-serif tracking-[0.18em]" style={{ color: 'rgba(var(--tj-accent-primary),0.6)' }}>
                      <span>分段</span>
                      {query && <span style={{ color: 'rgba(var(--tj-tech-cyan),0.8)' }}>匹配 {matchedCount}/{series.分段列表.length}</span>}
                    </div>
                    <div className="kaituo-options-scroll max-h-80 space-y-1 overflow-y-auto pr-1">
                      {visibleSegments.map((segment) => {
                        const selected = selectedSegmentId === segment.id;
                        const current = segment.运行状态 === '当前' || series.当前分段组号 === segment.组号;
                        const busy = busyId === segment.id;
                        return (
                          <button
                            key={segment.id}
                            onClick={() => onSelectSegment(segment)}
                            className="w-full px-2 py-2 text-left"
                            style={{
                              background: selected ? 'rgba(var(--tj-accent-primary),0.1)' : runtimeStatusBg[segment.运行状态] || statusBg[segment.处理状态],
                              border: `1px solid ${current ? 'rgba(var(--tj-accent-primary), var(--tj-edge-tint-strong))' : 'rgba(var(--tj-accent-primary), var(--tj-edge-tint-weak))'}`,
                              clipPath: smallClip,
                            }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate font-serif text-xs" style={{ color: selected ? 'rgb(var(--tj-accent-primary))' : 'rgba(var(--tj-text-secondary),0.84)' }}>
                                {segment.组号}. {segment.标题}
                              </span>
                              <span className="text-[10px]" style={{ color: runtimeStatusColor[segment.运行状态] }}>
                                {segment.运行状态}
                              </span>
                            </div>
                            <div className="mt-1 text-[11px]" style={{ color: statusColor[segment.处理状态] }}>
                              {busy ? '处理中...' : segment.处理状态} · {segment.章节范围}{segment.剧情地区 ? ` · ${segment.剧情地区}` : ''}
                            </div>
                          </button>
                        );
                      })}
                      {visibleSegments.length === 0 && <div className="px-2 py-1 text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary),0.6)' }}>无匹配分段</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
