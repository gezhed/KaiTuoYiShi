import { describe, expect, it } from 'vitest';
import type { NPC记录 } from '@/models/npc';
import type { 变量命令 } from '@/models/variableCommand';
import { getNsfwArchiveBlockReason, getNsfwEligibility } from '@/utils/nsfwArchivePolicy';
import { applyNsfwVariablePolicy } from '@/utils/variableNsfwPolicy';

function npc(patch: Partial<NPC记录> = {}): NPC记录 {
  return {
    id: 'npc_1',
    姓名: '三月七',
    阶位: 'companion',
    好感度: 20,
    关系: '熟识',
    ...patch,
  } as NPC记录;
}

describe('NSFW 资格代码门禁', () => {
  it('未建档默认待确认，不进入成人向内容', () => {
    const result = getNsfwEligibility(npc());
    expect(result.allowed).toBe(false);
    expect(result.level).toBe('unconfirmed');
  });

  it('成年确认自动允许', () => {
    const result = getNsfwEligibility(npc({ NSFW档案: { 年龄确认: 'adult' } }));
    expect(result.allowed).toBe(true);
    expect(result.source).toBe('auto');
  });

  it('手动允许可以覆盖年龄未确认，支持长相幼态但设定成年的角色', () => {
    const result = getNsfwEligibility(npc({
      NSFW档案: {
        年龄确认: 'unknown',
        NSFW资格: 'allowed',
        NSFW资格来源: 'manual',
        NSFW资格原因: '玩家确认成年',
      },
    }));
    expect(result.allowed).toBe(true);
    expect(result.source).toBe('manual');
  });

  it('未成年标记永远硬禁，手动允许也不能解除', () => {
    const result = getNsfwEligibility(npc({
      NSFW档案: {
        年龄确认: 'minor_blocked',
        NSFW资格: 'allowed',
        NSFW资格来源: 'manual',
      },
    }));
    expect(result.allowed).toBe(false);
    expect(result.level).toBe('blocked');
    expect(result.reason).toContain('未成年');
  });

  it('玩家手动禁止优先于成年确认', () => {
    const result = getNsfwEligibility(npc({
      NSFW档案: {
        年龄确认: 'adult',
        NSFW资格: 'blocked',
        NSFW资格来源: 'manual',
      },
    }));
    expect(result.allowed).toBe(false);
    expect(result.source).toBe('manual');
  });

  it('非人形身份始终阻止，不受资格影响', () => {
    const result = getNsfwEligibility(npc({
      姓名: '帕姆',
      NSFW档案: { 年龄确认: 'adult', NSFW资格: 'allowed', NSFW资格来源: 'manual' },
    }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('智械');
  });

  it('写入策略对未确认角色返回阻止原因，对成年角色放行', () => {
    expect(getNsfwArchiveBlockReason(npc(), '三月七')).toContain('年龄未确认');
    expect(getNsfwArchiveBlockReason(npc({ NSFW档案: { 年龄确认: 'adult' } }), '三月七')).toBeNull();
  });

  it('变量命令写入同样受代码门禁约束', () => {
    const command = {
      action: 'set',
      key: 'NPC[id=npc_1].NSFW档案',
      value: { enabled: true },
    } as 变量命令;
    const policy = { nsfwEnabled: true, maleNsfwArchiveEnabled: true };

    const blocked = applyNsfwVariablePolicy([command], policy, [npc()]);
    expect(blocked.allowedCommands).toHaveLength(0);
    expect(blocked.rejectedCommands[0]?.reason).toContain('年龄未确认');

    const allowed = applyNsfwVariablePolicy([command], policy, [npc({ NSFW档案: { 年龄确认: 'adult' } })]);
    expect(allowed.allowedCommands).toHaveLength(1);
    expect(allowed.rejectedCommands).toHaveLength(0);
  });
});
