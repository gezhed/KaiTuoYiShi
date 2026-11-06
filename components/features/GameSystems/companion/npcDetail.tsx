import { useState } from 'react';
import type { ReactNode } from 'react';
import type { NPC记录, NPC_NSFW年龄确认 } from '@/models/npc';
import { 格式化NPC关系, 读取NPC头像 } from '@/models/npc';
import type { 相册系统 } from '@/models/imageGeneration';
import type { NPC关系规划条目 } from '@/services/npcRelationshipPlanning';
import type { NPC关系脉络, NPC关系阶段 } from '@/models/npcRelationship';
import { NPC关系阶段列表, 更新NPC关系脉络 } from '@/models/npcRelationship';
import { 解析相册资源引用 } from '@/utils/albumActions';
import { getNsfwEligibility } from '@/utils/nsfwArchivePolicy';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { AffinityBadge } from './affinity';
import { accentColor, bodyColor, faintColor, mutedColor, nsfwColor, panelStyle, quietSurface, smallClip, titleColor } from './constants';
import { MemoryPanel } from './memory';
import { ActionChip, Avatar, Chip, DetailBlock, EmptyText, InfoPill, Paragraph, TabButton } from './primitives';

type DetailTab = 'archive' | 'planning' | 'relations' | 'memory' | 'nsfw';

export function NpcDetail({
  npc,
  album,
  onPromote,
  onDemote,
  onToggleTraveling,
  onDelete,
  onUpdateNpc,
  nsfwEnabled,
  planning,
  devMode,
  turnCount,
  onEditAvatar,
}: {
  npc: NPC记录;
  album?: 相册系统;
  onPromote: () => void;
  onDemote: () => void;
  onToggleTraveling: () => void;
  onDelete?: () => void;
  onUpdateNpc?: (patch: Partial<NPC记录>) => void;
  nsfwEnabled: boolean;
  planning?: NPC关系规划条目;
  devMode: boolean;
  turnCount?: number;
  /** 点视觉档案里的槽位卡片时打开头像编辑器。 */
  onEditAvatar?: (slot: '档案' | '正文' | '手机' | '立绘') => void;
}) {
  const isCompanion = npc.阶位 === 'companion';
  const [detailTab, setDetailTab] = useState<DetailTab>('archive');
  const [relationDraft, setRelationDraft] = useState<{ 目标姓名: string; 关系: string; 阶段: NPC关系阶段 | ''; 说明: string }>({
    目标姓名: '',
    关系: '',
    阶段: '',
    说明: '',
  });
  const [editingRelationId, setEditingRelationId] = useState<string | null>(null);
  const [relationEdit, setRelationEdit] = useState<{ 关系: string; 阶段: NPC关系阶段 | ''; 说明: string }>({
    关系: '',
    阶段: '',
    说明: '',
  });
  const relations = npc.关系脉络 ?? [];
  const relationTurn = turnCount ?? npc.最近回合;

  const addRelation = () => {
    if (!onUpdateNpc) return;
    const target = relationDraft.目标姓名.trim();
    if (!target) return;
    if (relations.some((edge) => edge.目标姓名 === target)) return;
    onUpdateNpc({
      关系脉络: 更新NPC关系脉络(relations, {
        目标姓名: target,
        关系: relationDraft.关系.trim() || undefined,
        阶段: relationDraft.阶段 || undefined,
        说明: relationDraft.说明.trim() || undefined,
        回合: relationTurn,
        原因: '手动添加',
        来源: '玩家',
      }),
    });
    setRelationDraft({ 目标姓名: '', 关系: '', 阶段: '', 说明: '' });
  };

  const startRelationEdit = (edge: NPC关系脉络) => {
    setEditingRelationId(edge.id);
    setRelationEdit({ 关系: edge.关系, 阶段: edge.阶段 ?? '', 说明: edge.说明 ?? '' });
  };

  const saveRelationEdit = (edge: NPC关系脉络) => {
    if (!onUpdateNpc) return;
    onUpdateNpc({
      关系脉络: 更新NPC关系脉络(relations, {
        目标姓名: edge.目标姓名,
        目标NPCID: edge.目标NPCID,
        关系: relationEdit.关系.trim() || edge.关系,
        阶段: relationEdit.阶段 || undefined,
        说明: relationEdit.说明.trim() || undefined,
        回合: relationTurn,
        原因: '手动修改',
        来源: '玩家',
      }),
    });
    setEditingRelationId(null);
  };

  const effectiveDetailTab: DetailTab =
    detailTab === 'nsfw' && !nsfwEnabled
      ? 'archive'
      : detailTab === 'planning' && !planning
        ? 'archive'
        : detailTab;

  return (
    <div className="flex min-h-full flex-col gap-4">
      <section className="px-5 py-4" style={panelStyle}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="relative shrink-0">
            <Avatar npc={npc} album={album} size={88} selected />
            {npc.同行 && (
              <div
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 font-serif text-[11px] tracking-[0.18em]"
                style={{
                  color: 'rgba(var(--tj-ui-success),0.96)',
                  background: 'rgba(var(--tj-panel-bg-start),0.92)',
                  border: '1px solid rgba(var(--tj-ui-success), var(--tj-edge-weak))',
                  clipPath: smallClip,
                }}
              >
                在场
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                className="truncate font-serif text-[24px] font-semibold tracking-[0.18em]"
                style={{
                  background: 'linear-gradient(135deg, rgb(var(--tj-ui-title)) 0%, rgb(var(--tj-accent-primary)) 58%, rgb(var(--tj-accent-secondary)) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                {npc.姓名}
              </h3>
              {npc.别名 && <span className="font-serif text-[13px] italic text-[rgb(var(--tj-text-secondary))]">({npc.别名})</span>}
              {npc.原著角色 && <Chip tone="gold">原著角色</Chip>}
              {npc.图像档案?.状态 && <Chip tone="silver">{npc.图像档案.状态 === 'pending' ? '图像生成中' : '图像档案'}</Chip>}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
              <InfoPill label="性别" value={npc.性别 || '未知'} />
              <InfoPill label="关系" value={格式化NPC关系(npc.好感度, Boolean(npc.亲密关系))} />
              <InfoPill label="最近" value={`第 ${npc.最近回合} 回合`} />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {isCompanion && (
                <ActionChip active={npc.同行} onClick={onToggleTraveling}>
                  {npc.同行 ? '当前在场' : '设为在场'}
                </ActionChip>
              )}
              {isCompanion ? (
                npc.原著角色 ? (
                  <Chip tone="gold">常驻伙伴</Chip>
                ) : (
                  <ActionChip active onClick={onDemote}>
                    重要伙伴
                  </ActionChip>
                )
              ) : (
                <ActionChip active={false} onClick={onPromote}>
                  标为伙伴
                </ActionChip>
              )}
              <span
                className="font-serif text-[12px] tracking-[0.12em] px-2 py-1"
                style={{ color: faintColor }}
              >
                初见第 {npc.初见回合} 回合
              </span>
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="px-2 py-1 font-serif text-[12px] tracking-[0.16em] transition-all hover:bg-[rgba(var(--tj-danger),0.12)]"
                  style={{
                    color: 'rgba(var(--tj-danger), 0.92)',
                    border: '1px solid rgba(var(--tj-danger), var(--tj-edge-tint))',
                    clipPath: smallClip,
                  }}
                >
                  移出档案
                </button>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-3 xl:w-[360px] xl:items-stretch">
            <div className="flex justify-end">
              <AffinityBadge value={npc.好感度} />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              <TabButton active={effectiveDetailTab === 'archive'} onClick={() => setDetailTab('archive')}>
                伙伴档案
              </TabButton>
              {planning && (
                <TabButton active={effectiveDetailTab === 'planning'} onClick={() => setDetailTab('planning')}>
                  关系规划
                </TabButton>
              )}
              <TabButton active={effectiveDetailTab === 'memory'} onClick={() => setDetailTab('memory')}>
                {devMode ? '记忆账本' : '同行记忆'}
              </TabButton>
              <TabButton active={effectiveDetailTab === 'relations'} onClick={() => setDetailTab('relations')}>
                关系脉络
              </TabButton>
              {nsfwEnabled && (
                <TabButton active={effectiveDetailTab === 'nsfw'} onClick={() => setDetailTab('nsfw')}>
                  NSFW档案
                </TabButton>
              )}
            </div>
          </div>
        </div>
      </section>

      {planning && effectiveDetailTab === 'planning' && (
        <section className="px-4 py-3 text-xs leading-relaxed" style={panelStyle}>
          <div className="font-serif text-[12px] tracking-[0.22em]" style={{ color: accentColor }}>
            关系规划
          </div>
          <div className="mt-2 flex flex-wrap gap-2" style={{ color: bodyColor }}>
            <span>优先级：{planning.优先级}</span>
            <span>建议：{planning.建议动作}</span>
          </div>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <MiniList title="理由" items={planning.理由} />
            <MiniList title="关注点" items={planning.关注点} />
          </div>
        </section>
      )}

      {effectiveDetailTab === 'archive' && (
        <>
          <section className="grid gap-4 xl:grid-cols-2">
            <DetailBlock title="人物介绍">
              <Paragraph text={npc.介绍 || npc.性格} placeholder="尚无人物介绍" />
            </DetailBlock>
            <DetailBlock title="对你的称呼">
              <Paragraph text={npc.对玩家称呼} placeholder="尚未形成固定称呼" italic />
            </DetailBlock>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <DetailBlock title="外貌">
              <Paragraph text={npc.外貌} placeholder="尚无外貌记录" />
            </DetailBlock>
            <DetailBlock title="穿着">
              <Paragraph text={npc.穿着} placeholder="尚无穿着记录" />
            </DetailBlock>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <DetailBlock title="说话方式">
              <Paragraph text={npc.说话方式} placeholder="尚无说话方式记录" />
            </DetailBlock>
            <DetailBlock title="性格">
              <Paragraph text={npc.性格} placeholder="尚无性格记录" />
            </DetailBlock>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <DetailBlock title="装备面板">
              <Paragraph text={npc.装备摘要} placeholder="尚未记录其装备与随身物" italic />
            </DetailBlock>
            <VisualArchivePanel npc={npc} album={album} onEditAvatar={onEditAvatar} />
          </section>
        </>
      )}

      {effectiveDetailTab === 'memory' && <MemoryPanel npc={npc} devMode={devMode} />}

      {effectiveDetailTab === 'relations' && (
        <section className="px-4 py-3" style={panelStyle}>
          <div className="flex items-center justify-between gap-3">
            <div className="font-serif text-[12px] tracking-[0.22em]" style={{ color: accentColor }}>
              关系脉络
            </div>
            <div className="text-[11px]" style={{ color: mutedColor }}>
              {relations.length} / 24
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {relations.length ? relations.map((edge) => (
              <div
                key={edge.id}
                className="rounded-md border px-3 py-2"
                style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)' }}
              >
                {editingRelationId === edge.id ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <input
                        value={relationEdit.关系}
                        onChange={(event) => setRelationEdit((prev) => ({ ...prev, 关系: event.target.value }))}
                        placeholder="关系（如：同一后宫的姐妹）"
                        className="min-w-0 rounded border bg-transparent px-2 py-1 text-xs outline-none"
                        style={{ borderColor: 'rgba(255,255,255,0.14)', color: bodyColor }}
                      />
                      <select
                        value={relationEdit.阶段}
                        onChange={(event) => setRelationEdit((prev) => ({ ...prev, 阶段: event.target.value as NPC关系阶段 | '' }))}
                        className="rounded border bg-transparent px-2 py-1 text-xs outline-none"
                        style={{ borderColor: 'rgba(255,255,255,0.14)', color: bodyColor, background: 'rgba(18,18,22,0.96)' }}
                      >
                        <option value="">不标阶段</option>
                        {NPC关系阶段列表.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                      </select>
                    </div>
                    <input
                      value={relationEdit.说明}
                      onChange={(event) => setRelationEdit((prev) => ({ ...prev, 说明: event.target.value }))}
                      placeholder="说明（可选）"
                      className="w-full rounded border bg-transparent px-2 py-1 text-xs outline-none"
                      style={{ borderColor: 'rgba(255,255,255,0.14)', color: bodyColor }}
                    />
                    <div className="flex gap-3">
                      <button type="button" onClick={() => saveRelationEdit(edge)} className="text-[11px]" style={{ color: accentColor }}>
                        保存
                      </button>
                      <button type="button" onClick={() => setEditingRelationId(null)} className="text-[11px]" style={{ color: mutedColor }}>
                        取消
                      </button>
                      <span className="ml-auto text-[10px]" style={{ color: faintColor }}>
                        未保存前不会写入存档
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-serif text-[13px]" style={{ color: titleColor }}>{edge.目标姓名}</span>
                      <span className="text-[11px]" style={{ color: accentColor }}>{edge.关系}</span>
                      {edge.阶段 && (
                        <span
                          className="rounded border px-1.5 py-0.5 text-[10px]"
                          style={{ borderColor: 'rgba(var(--tj-accent-primary),0.3)', color: accentColor }}
                        >
                          {edge.阶段}
                        </span>
                      )}
                      <span className="text-[10px]" style={{ color: faintColor }}>{edge.来源 ?? '资料库'}</span>
                      {onUpdateNpc && (
                        <span className="ml-auto flex items-center gap-3">
                          <button type="button" onClick={() => startRelationEdit(edge)} className="text-[10px]" style={{ color: accentColor }}>
                            改
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateNpc({ 关系脉络: relations.filter((item) => item.id !== edge.id) })}
                            className="text-[10px]"
                            style={{ color: 'rgba(var(--tj-danger),0.9)' }}
                          >
                            删除
                          </button>
                        </span>
                      )}
                    </div>
                    {edge.说明 && (
                      <div className="mt-1 text-[11px] leading-relaxed" style={{ color: bodyColor }}>
                        {edge.说明}
                      </div>
                    )}
                    {edge.变更记录?.length ? (
                      <div className="mt-1 space-y-0.5">
                        {edge.变更记录.slice(-2).map((change, index) => (
                          <div key={`${change.回合}-${index}`} className="text-[10px]" style={{ color: faintColor }}>
                            第 {change.回合} 回合：{change.从 ? `${change.从} → ` : ''}{change.到}
                            {change.原因 ? `（${change.原因}）` : ''}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            )) : (
              <EmptyText text="暂无关系脉络；开局会从资料库补齐，也可以在这里手动添加。" />
            )}
          </div>
          {onUpdateNpc && (
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto_2fr_auto]">
              <input
                value={relationDraft.目标姓名}
                onChange={(event) => setRelationDraft((prev) => ({ ...prev, 目标姓名: event.target.value }))}
                placeholder="角色名"
                className="min-w-0 rounded border bg-transparent px-2 py-1 text-xs outline-none"
                style={{ borderColor: 'rgba(255,255,255,0.14)', color: bodyColor }}
              />
              <input
                value={relationDraft.关系}
                onChange={(event) => setRelationDraft((prev) => ({ ...prev, 关系: event.target.value }))}
                placeholder="关系（如：旧识）"
                className="min-w-0 rounded border bg-transparent px-2 py-1 text-xs outline-none"
                style={{ borderColor: 'rgba(255,255,255,0.14)', color: bodyColor }}
              />
              <select
                value={relationDraft.阶段}
                onChange={(event) => setRelationDraft((prev) => ({ ...prev, 阶段: event.target.value as NPC关系阶段 | '' }))}
                className="rounded border bg-transparent px-2 py-1 text-xs outline-none"
                style={{ borderColor: 'rgba(255,255,255,0.14)', color: bodyColor, background: 'rgba(18,18,22,0.96)' }}
              >
                <option value="">阶段</option>
                {NPC关系阶段列表.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
              </select>
              <input
                value={relationDraft.说明}
                onChange={(event) => setRelationDraft((prev) => ({ ...prev, 说明: event.target.value }))}
                placeholder="说明（可选）"
                className="min-w-0 rounded border bg-transparent px-2 py-1 text-xs outline-none"
                style={{ borderColor: 'rgba(255,255,255,0.14)', color: bodyColor }}
              />
              <button
                type="button"
                onClick={addRelation}
                className="rounded border px-3 py-1 text-xs"
                style={{ borderColor: 'rgba(var(--tj-accent-primary),0.4)', color: accentColor }}
              >
                添加
              </button>
            </div>
          )}
        </section>
      )}

      {nsfwEnabled && effectiveDetailTab === 'nsfw' && <NSFWArchivePanel npc={npc} onUpdateNpc={onUpdateNpc} />}
    </div>
  );
}

function VisualArchivePanel({
  npc,
  album,
  onEditAvatar,
}: {
  npc: NPC记录;
  album?: 相册系统;
  onEditAvatar?: (slot: '档案' | '正文' | '手机' | '立绘') => void;
}) {
  return (
    <DetailBlock title="视觉档案">
      <div className="grid gap-3 sm:grid-cols-3">
        <AvatarSlotCard npc={npc} album={album} slot="档案" label="档案头像" description="伙伴面板" onEdit={onEditAvatar} />
        <AvatarSlotCard npc={npc} album={album} slot="正文" label="正文头像" description="剧情气泡" onEdit={onEditAvatar} />
        <AvatarSlotCard npc={npc} album={album} slot="手机" label="小手机头像" description="短讯名片" onEdit={onEditAvatar} />
      </div>
      {onEditAvatar && (
        <div className="mt-2 text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary),0.72)' }}>
          点卡片可以出图或从图库里挑一张换上；图库在「视觉资产 → 图库」。
        </div>
      )}
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <InfoPill label="图像状态" value={npc.图像档案?.状态 ?? 'none'} />
        <InfoPill label="图像来源" value={npc.图像档案?.来源 ?? (读取NPC头像(npc) ? '手动 / 原著' : '未设定')} />
      </div>
      <div className="mt-3 space-y-1">
        <Paragraph text={npc.图像档案?.头像提示词} placeholder="未记录头像提示词" italic />
        <Paragraph text={npc.图像档案?.立绘提示词} placeholder="未记录立绘提示词" italic />
      </div>
    </DetailBlock>
  );
}

function AvatarSlotCard({
  npc,
  album,
  slot,
  label,
  description,
  onEdit,
}: {
  npc: NPC记录;
  album?: 相册系统;
  slot: '档案' | '正文' | '手机';
  label: string;
  description: string;
  onEdit?: (slot: '档案' | '正文' | '手机' | '立绘') => void;
}) {
  const src = 解析相册资源引用(album, 读取NPC头像(npc, slot));
  const 内容 = (
    <>
      <Avatar npc={npc} album={album} size={42} slot={slot} selected={Boolean(src)} />
      <div className="min-w-0 text-left">
        <div className="truncate font-serif text-[12px] font-semibold tracking-[0.16em]" style={{ color: titleColor }}>
          {label}
        </div>
        <div className="mt-0.5 truncate text-[10.5px] tracking-[0.12em]" style={{ color: faintColor }}>
          {src ? description : `${description} · 待生成`}
        </div>
      </div>
    </>
  );
  const 样式 = {
    background: src ? 'rgba(var(--tj-btn-primary-start), 0.075)' : quietSurface,
    border: src
      ? '1px solid rgba(var(--tj-btn-primary-start), var(--tj-edge-tint-strong))'
      : '1px solid rgba(var(--tj-border), var(--tj-edge-weak))',
    clipPath: smallClip,
  } as const;
  return onEdit ? (
    <button
      type="button"
      onClick={() => onEdit(slot)}
      className="flex min-w-0 items-center gap-3 px-3 py-3 transition-all hover:opacity-90"
      style={样式}
      title="点击更换这个头像"
    >
      {内容}
    </button>
  ) : (
    <div className="flex min-w-0 items-center gap-3 px-3 py-3" style={样式}>
      {内容}
    </div>
  );
}

function NSFWArchivePanel({ npc, onUpdateNpc }: { npc: NPC记录; onUpdateNpc?: (patch: Partial<NPC记录>) => void }) {
  const archive = npc.NSFW档案;
  const tags = archive?.标签 ?? [];
  const femaleBodyArchive = archive?.女性身体档案;
  const maleBodyArchive = archive?.男性身体档案;
  const bodyPane = npc.性别 === '男' ? 'male' : 'female';
  const eligibility = getNsfwEligibility(npc);
  const canOverride = eligibility.age !== 'minor_blocked';
  const updateArchive = (patch: NonNullable<NPC记录['NSFW档案']>) => {
    onUpdateNpc?.({ NSFW档案: { ...(npc.NSFW档案 ?? {}), ...patch } });
  };
  const allowNsfw = () => updateArchive({
    enabled: true,
    年龄确认: 'adult',
    NSFW资格: 'allowed',
    NSFW资格来源: 'manual',
    NSFW资格原因: '玩家确认该角色成年并允许作为 NSFW 剧情对象',
  });
  const blockNsfw = () => updateArchive({
    NSFW资格: 'blocked',
    NSFW资格来源: 'manual',
    NSFW资格原因: '玩家禁止该角色作为 NSFW 剧情对象',
  });
  const resetNsfw = () => {
    const next = { ...(npc.NSFW档案 ?? {}) };
    delete next.NSFW资格;
    delete next.NSFW资格来源;
    delete next.NSFW资格原因;
    onUpdateNpc?.({ NSFW档案: next });
  };
  return (
    <DetailBlock title="NSFW档案">
      <div
        className="px-4 py-4"
        style={{
          background: 'linear-gradient(135deg, rgba(var(--tj-ui-nsfw), 0.13), rgba(var(--tj-ui-panel), 0.72))',
          border: '1px solid rgba(var(--tj-ui-nsfw), var(--tj-edge-tint))',
          clipPath: smallClip,
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-serif text-[13px] font-semibold tracking-[0.22em]" style={{ color: titleColor }}>
              独立档案接口
            </div>
            <div className="mt-1 text-[11px] tracking-[0.12em]" style={{ color: faintColor }}>
              后续 NSFW 模式读取，普通剧情默认不调用
            </div>
          </div>
          <Chip tone={archive?.enabled ? 'gold' : 'silver'}>
            {archive?.enabled ? '已启用' : '预留'}
          </Chip>
        </div>

        <div
          className="mt-4 px-3 py-3"
          style={{
            background: 'rgba(var(--tj-ui-panel-strong), 0.42)',
            border: '1px solid rgba(var(--tj-ui-nsfw), var(--tj-edge-tint-weak))',
            clipPath: smallClip,
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="font-serif text-[12px] tracking-[0.18em]" style={{ color: nsfwColor }}>
              NSFW 资格（代码门禁）
            </div>
            <Chip tone={eligibility.allowed ? 'gold' : 'silver'}>
              {eligibility.allowed ? '允许' : eligibility.level === 'unconfirmed' ? '待确认' : '禁止'}
            </Chip>
          </div>
          <div className="mt-1 text-[11px] leading-relaxed" style={{ color: faintColor }}>
            {eligibility.reason}
          </div>
          <div className="mt-1 text-[11px] leading-relaxed" style={{ color: faintColor }}>
            只有“允许”的成年角色才能进入成人向正文与档案写入；手动允许不能解除未成年标记。
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canOverride || eligibility.allowed}
              onClick={allowNsfw}
              className="px-3 py-1.5 font-serif text-[11px] tracking-[0.12em] disabled:cursor-not-allowed disabled:opacity-45"
              style={{
                color: 'rgb(var(--tj-on-accent))',
                background: 'linear-gradient(135deg, rgba(var(--tj-ui-nsfw), 0.92), rgba(var(--tj-ui-nsfw), 0.66))',
                border: '1px solid rgba(var(--tj-ui-nsfw), var(--tj-edge))',
                clipPath: smallClip,
              }}
            >
              确认成年并允许
            </button>
            <button
              type="button"
              disabled={!canOverride || (!eligibility.allowed && eligibility.level !== 'unconfirmed')}
              onClick={blockNsfw}
              className="px-3 py-1.5 font-serif text-[11px] tracking-[0.12em] disabled:cursor-not-allowed disabled:opacity-45"
              style={{
                color: nsfwColor,
                background: 'rgba(var(--tj-ui-nsfw), 0.08)',
                border: '1px solid rgba(var(--tj-ui-nsfw), var(--tj-edge-tint))',
                clipPath: smallClip,
              }}
            >
              禁止
            </button>
            {eligibility.source === 'manual' && (
              <button
                type="button"
                onClick={resetNsfw}
                className="px-3 py-1.5 font-serif text-[11px] tracking-[0.12em]"
                style={{
                  color: mutedColor,
                  background: 'rgba(var(--tj-ui-panel), 0.5)',
                  border: '1px solid rgba(var(--tj-ui-nsfw), var(--tj-edge-tint-weak))',
                  clipPath: smallClip,
                }}
              >
                恢复自动判断
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <InfoPill label="年龄确认" value={formatNsfwAge(archive?.年龄确认)} />
          <InfoPill label="亲密阶段" value={archive?.亲密阶段 ?? '未记录'} />
          <InfoPill label="边界" value={archive?.边界 ?? '未记录'} />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <TagGroup title="偏好" items={archive?.偏好 ?? []} empty="暂无偏好记录" />
          <TagGroup title="敏感点" items={archive?.敏感点 ?? []} empty="暂无敏感点记录" />
          <TagGroup title="禁忌" items={archive?.禁忌 ?? []} empty="暂无禁忌记录" />
        </div>

        <div className="mt-4">
          {bodyPane === 'female' ? (
            <BodyArchiveSection title="女性身体档案">
              <ArchiveField title="胸部" text={femaleBodyArchive?.胸部} />
              <ArchiveField title="女性私处" text={femaleBodyArchive?.女性私处} />
              <ArchiveField title="后庭" text={femaleBodyArchive?.后庭} />
              <ArchiveField title="体态" text={femaleBodyArchive?.体态} />
              <ArchiveField title="体味" text={femaleBodyArchive?.体味} />
            </BodyArchiveSection>
          ) : (
            <BodyArchiveSection title="男性身体档案">
              <ArchiveField title="男性器" text={maleBodyArchive?.男性器} />
              <ArchiveField title="后庭" text={maleBodyArchive?.后庭} />
              <ArchiveField title="体态" text={maleBodyArchive?.体态} />
              <ArchiveField title="体味" text={maleBodyArchive?.体味} />
            </BodyArchiveSection>
          )}
        </div>

        {archive?.部位图片 && (
          <div className="mt-4">
            <BodyArchiveSection title="NSFW 部位图片">
              <PartImageSlot title="女性胸部" src={archive.部位图片.女性胸部} />
              <PartImageSlot title="女性私处" src={archive.部位图片.女性私处} />
              <PartImageSlot title="男性器" src={archive.部位图片.男性器} />
              <PartImageSlot title="后庭" src={archive.部位图片.后庭} />
              <PartImageSlot title="体态参考" src={archive.部位图片.体态参考} />
            </BodyArchiveSection>
          </div>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <ListBlock title="经历" items={archive?.经历 ?? []} empty="暂无亲密经历记录" />
          <ListBlock title="长期事实" items={archive?.长期事实 ?? []} empty="暂无长期事实记录" />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {tags.length ? (
            tags.map((tag) => <Chip key={tag} tone="silver">{tag}</Chip>)
          ) : (
            <span className="font-serif text-[12px] italic tracking-[0.12em]" style={{ color: faintColor }}>
              暂无标签，等待后续模式写入
            </span>
          )}
        </div>

        <div className="mt-3">
          <Paragraph text={archive?.备注} placeholder="暂无 NSFW 备注" italic />
        </div>
      </div>
    </DetailBlock>
  );
}

function PartImageSlot({ title, src }: { title: string; src?: string }) {
  return (
    <div
      className="overflow-hidden"
      style={{
        background: src ? 'rgba(var(--tj-ui-nsfw), 0.075)' : 'rgba(var(--tj-ui-nsfw), 0.035)',
        border: src ? '1px solid rgba(var(--tj-ui-nsfw), var(--tj-edge-tint))' : '1px solid rgba(var(--tj-ui-nsfw), var(--tj-edge-tint-weak))',
        clipPath: smallClip,
      }}
    >
      <div className="aspect-[4/3]" style={{ background: 'rgba(var(--tj-ui-panel-strong), 0.58)' }}>
        {src ? <ResilientImage src={src} alt={title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[11px]" style={{ color: 'rgba(var(--tj-ui-nsfw),0.56)' }}>待挂载</div>}
      </div>
      <div className="px-2 py-1.5 text-[11px]" style={{ color: nsfwColor }}>{title}</div>
    </div>
  );
}

function BodyArchiveSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-serif text-[12px] tracking-[0.24em]" style={{ color: accentColor }}>
        {title}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {children}
      </div>
    </div>
  );
}

function formatNsfwAge(age: NPC_NSFW年龄确认 | undefined): string {
  // 年龄确认参与代码门禁；展示时只做文案映射。
  if (age === 'adult') return '成人';
  if (age === 'minor_blocked') return '标注未成年';
  if (age === 'unknown') return '未标注';
  return '未标注';
}

function TagGroup({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="min-w-0 px-3 py-3" style={{ background: 'rgba(var(--tj-ui-panel),0.68)', border: '1px solid rgba(var(--tj-ui-nsfw), var(--tj-edge-tint))', clipPath: smallClip }}>
      <div className="mb-2 font-serif text-[11px] tracking-[0.24em]" style={{ color: 'rgba(var(--tj-ui-nsfw),0.82)' }}>
        {title}
      </div>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => <Chip key={item} tone="silver">{item}</Chip>)}
        </div>
      ) : (
        <EmptyText text={empty} />
      )}
    </div>
  );
}

function ArchiveField({ title, text }: { title: string; text?: string }) {
  return (
    <div className="min-w-0 px-3 py-3" style={{ background: 'rgba(var(--tj-ui-panel),0.66)', border: '1px solid rgba(var(--tj-ui-nsfw), var(--tj-edge-tint-weak))', clipPath: smallClip }}>
      <div className="mb-2 font-serif text-[11px] tracking-[0.24em]" style={{ color: 'rgba(var(--tj-ui-nsfw),0.82)' }}>
        {title}
      </div>
      <Paragraph text={text} placeholder="未记录" />
    </div>
  );
}

function ListBlock({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="min-w-0 px-3 py-3" style={{ background: 'rgba(var(--tj-ui-panel),0.66)', border: '1px solid rgba(var(--tj-ui-nsfw), var(--tj-edge-tint-weak))', clipPath: smallClip }}>
      <div className="mb-2 font-serif text-[11px] tracking-[0.24em]" style={{ color: 'rgba(var(--tj-ui-nsfw),0.82)' }}>
        {title}
      </div>
      {items.length ? (
        <ul className="max-h-[180px] space-y-1.5 overflow-y-auto pr-1">
          {items.map((item, index) => (
            <li key={`${index}-${item}`} className="font-serif text-[13px] leading-relaxed tracking-[0.06em]" style={{ color: bodyColor }}>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyText text={empty} />
      )}
    </div>
  );
}

function MiniList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="font-serif text-[11px] tracking-[0.18em]" style={{ color: accentColor }}>{title}</div>
      <div className="mt-1 space-y-1" style={{ color: mutedColor }}>
        {(items.length ? items : ['暂无']).slice(0, 5).map((item, index) => (
          <div key={`${title}_${item}_${index}`}>- {compactListText(item)}</div>
        ))}
      </div>
    </div>
  );
}

function compactListText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 72) return normalized;
  return `${normalized.slice(0, 71)}…`;
}
