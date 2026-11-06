import type { 朋友圈动态 } from '@/models/moments';
import { cardClip, phoneCardSurface, smallClip } from './phoneStyles';

function 时间标签(moment: 朋友圈动态): string {
  return `第 ${moment.回合} 回合`;
}

export function MomentsApp({ moments }: { moments: 朋友圈动态[] }) {
  const list = [...moments].sort((a, b) => b.回合 - a.回合 || b.创建时间 - a.创建时间);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
      <div
        className="mb-4 overflow-hidden p-4"
        style={{
          background: 'linear-gradient(135deg, rgba(var(--tj-accent-primary), 0.16), rgba(var(--tj-tech-cyan, var(--tj-accent-primary)), 0.06))',
          border: '1px solid rgba(var(--tj-accent-primary), var(--tj-edge-tint))',
          clipPath: cardClip,
        }}
      >
        <div className="font-serif text-sm tracking-[0.22em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
          朋友圈
        </div>
        <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.72)' }}>
          主线之外的生活切片。只有和作者有直接关系的人，才会知道这些动态。
        </div>
      </div>

      {list.length === 0 ? (
        <div
          className="p-6 text-center text-xs leading-relaxed"
          style={{ color: 'rgba(var(--tj-text-secondary), 0.66)', background: phoneCardSurface, border: '1px solid rgba(var(--tj-border), var(--tj-edge))', clipPath: cardClip }}
        >
          还没有动态。
          <br />
          每过几个回合，不在场的伙伴会在这里留下一点生活痕迹。
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((moment) => (
            <article
              key={moment.id}
              className="p-3 sm:p-4"
              style={{
                background: phoneCardSurface,
                border: '1px solid rgba(var(--tj-border), var(--tj-edge))',
                clipPath: cardClip,
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="flex h-9 w-9 flex-none items-center justify-center font-serif text-sm"
                  style={{
                    color: 'rgb(var(--tj-accent-primary))',
                    background: 'linear-gradient(135deg, rgba(var(--tj-surface), 0.96), rgba(var(--tj-surface-strong), 0.82))',
                    border: '1px solid rgba(var(--tj-border), var(--tj-edge))',
                    clipPath: smallClip,
                  }}
                >
                  {moment.作者姓名.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-serif text-[13px] font-semibold tracking-[0.12em]" style={{ color: 'rgb(var(--tj-text-primary))' }}>
                      {moment.作者姓名}
                    </span>
                    <span className="text-[10px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.55)' }}>
                      {时间标签(moment)}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-primary), 0.92)' }}>
                    {moment.内容}
                  </p>
                  {moment.图片 ? (
                    <div className="mt-2 overflow-hidden" style={{ border: '1px solid rgba(var(--tj-border), var(--tj-edge))', clipPath: smallClip }}>
                      <img
                        src={moment.图片.数据地址}
                        alt={moment.配图 || `${moment.作者姓名}的朋友圈配图`}
                        loading="lazy"
                        className="block w-full"
                        style={{ maxHeight: 300, objectFit: 'cover' }}
                      />
                      {moment.配图 ? (
                        <div className="px-2.5 py-1.5 text-[10px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.62)', background: 'rgba(var(--tj-bg-secondary), 0.45)' }}>
                          {moment.配图}
                        </div>
                      ) : null}
                    </div>
                  ) : moment.配图 ? (
                    <div
                      className="mt-2 px-3 py-2 text-[11px]"
                      style={{
                        color: 'rgba(var(--tj-text-secondary), 0.72)',
                        background: 'rgba(var(--tj-bg-secondary), 0.5)',
                        border: '1px dashed rgba(var(--tj-border), var(--tj-edge))',
                      }}
                    >
                      配图：{moment.配图}
                    </div>
                  ) : null}
                  {moment.知情角色.length > 0 ? (
                    <div className="mt-2 text-[10px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.5)' }}>
                      知道这条动态的人：{moment.知情角色.join('、')}
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
