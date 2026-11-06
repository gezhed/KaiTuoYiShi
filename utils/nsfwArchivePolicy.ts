import { matchCanonical } from '@/data/canonicalCharacters';
import type { NPC记录, NPC_NSFW年龄确认 } from '@/models/npc';

const BLOCKED_CANONICAL_NAMES = new Set(['帕姆', '佩佩', '史瓦罗']);
const BLOCKED_IDENTITY_RE = /(帕姆|Pom-Pom|Pom Pom|佩佩|Pepper|史瓦罗|Svarog|机械|机兵|虚卒|机器人|机械造物|傀儡|人偶|投影|怪物|裂界生物)/i;
const HERTA_IDENTITY_RE = /^(?:黑塔|大黑塔|Herta|The\s*Herta)$/i;

type NsfwArchiveSubject = Pick<NPC记录, '姓名' | '别名' | 'NSFW档案'> | undefined;

export type NsfwEligibilityLevel = 'allowed' | 'blocked' | 'unconfirmed';

export interface NsfwEligibility {
  allowed: boolean;
  level: NsfwEligibilityLevel;
  reason: string;
  source: 'auto' | 'manual';
  age: NPC_NSFW年龄确认;
}

function identityTexts(subject: NsfwArchiveSubject, fallbackName = ''): string[] {
  return [fallbackName, subject?.姓名, subject?.别名]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .flatMap((value) => value.split(/[/、,，]/).map((item) => item.trim()).filter(Boolean));
}

export function isHertaIdentity(subject: NsfwArchiveSubject, fallbackName = ''): boolean {
  return identityTexts(subject, fallbackName).some((name) => {
    if (HERTA_IDENTITY_RE.test(name)) return true;
    return matchCanonical(name)?.name === '黑塔';
  });
}

/** 只做身份硬禁（智械/机械/非人形），不看年龄。用于基线档案生成等“先建档”场景。 */
export function getNsfwIdentityBlockReason(
  subject: NsfwArchiveSubject,
  fallbackName = '',
  fallbackText = '',
): string | null {
// 命令值不是目标身份，不得参与硬禁判断。
  void fallbackText;
  if (isHertaIdentity(subject, fallbackName)) return null;

  const names = identityTexts(subject, fallbackName);
  const canonicalName = names.map((name) => matchCanonical(name)?.name).find(Boolean);
  const displayName = subject?.姓名 || fallbackName || '目标';
  if (canonicalName && BLOCKED_CANONICAL_NAMES.has(canonicalName)) {
    return `${displayName} 属于智械、机械或非人形对象，禁止写入 NSFW 档案`;
  }

// 只用身份文本判定：介绍/外貌里的机械、人偶只是剧情上下文。
  if (BLOCKED_IDENTITY_RE.test(names.join(' '))) {
    return `${displayName} 命中智械、机械或非人形对象屏蔽规则，禁止写入 NSFW 档案`;
  }
  return null;
}

/**
 * 代码层资格判断：
 * 1. 未成年标记（minor_blocked）永远硬禁，手动允许也不能覆盖；
 * 2. 玩家手动“禁止”优先；
 * 3. 玩家手动“允许”可覆盖“年龄未确认”，用于长相幼态但设定成年的角色；
 * 4. 年龄确认为 adult 时自动允许；
 * 5. 其余情况默认不算允许，需要玩家在 NSFW 档案里确认。
 */
export function getNsfwEligibility(subject: NsfwArchiveSubject, fallbackName = ''): NsfwEligibility {
  const archive = subject?.NSFW档案;
  const age = archive?.年龄确认 ?? 'unknown';
  const eligibility = archive?.NSFW资格;
  const manual = archive?.NSFW资格来源 === 'manual' && Boolean(eligibility);
  const identityReason = getNsfwIdentityBlockReason(subject, fallbackName);

  if (identityReason) {
    return { allowed: false, level: 'blocked', reason: identityReason, source: 'auto', age };
  }
  if (age === 'minor_blocked') {
    return {
      allowed: false,
      level: 'blocked',
      reason: '已标记为未成年或禁止 NSFW；该标记不能通过手动允许解除',
      source: 'auto',
      age,
    };
  }
  if (manual && eligibility === 'blocked') {
    return {
      allowed: false,
      level: 'blocked',
      reason: archive.NSFW资格原因 || '玩家已手动禁止该角色作为 NSFW 剧情对象',
      source: 'manual',
      age,
    };
  }
  if (manual && eligibility === 'allowed') {
    return {
      allowed: true,
      level: 'allowed',
      reason: archive.NSFW资格原因 || '玩家已手动确认该角色成年并允许',
      source: 'manual',
      age,
    };
  }
  if (age === 'adult') {
    return { allowed: true, level: 'allowed', reason: '年龄确认：成年', source: 'auto', age };
  }
  return {
    allowed: false,
    level: 'unconfirmed',
    reason: '年龄未确认；请在 NSFW 档案中确认成年，或由玩家手动允许',
    source: 'auto',
    age,
  };
}

export function getNsfwArchiveBlockReason(
  subject: NsfwArchiveSubject,
  fallbackName = '',
  fallbackText = '',
): string | null {
  const identityReason = getNsfwIdentityBlockReason(subject, fallbackName, fallbackText);
  if (identityReason) return identityReason;
  const eligibility = getNsfwEligibility(subject, fallbackName);
  if (eligibility.allowed) return null;
  const displayName = subject?.姓名 || fallbackName || '目标';
  return `${displayName} ${eligibility.reason}`;
}
