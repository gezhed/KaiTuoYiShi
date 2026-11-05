import { CANONICAL_CHARACTERS, matchCanonical } from '@/data/canonicalCharacters';
import {
  创建NPC记录,
  归一化NPC记录列表,
  获取NPC兼容关系,
  获取NPC关系阶段,
  type NPC记录,
  type NPC同行记忆条目,
} from '@/models/npc';

/** 从旅人背景/开局设定中抽出的“主线前已存在关系”。 */
export interface 前史关系种子 {
  姓名: string;
  关系描述: string;
  好感度: number;
  亲密关系: boolean;
  证据: string;
  原著角色: boolean;
}

interface 关系规则 {
  正则: RegExp;
  关系描述: string;
  好感度: number;
  亲密关系: boolean;
}

/** 顺序有意义：先判敌对/恋人这类强关系，再落到泛化的“旧识”。 */
const 关系规则表: 关系规则[] = [
  {
    正则: /仇人|死敌|敌对|宿敌|背叛|追杀|决裂|反目|不共戴天/u,
    关系描述: '敌对',
    好感度: -31,
    亲密关系: false,
  },
  {
    正则: /恋人|爱人|伴侣|夫妻|情侣|交往|相恋|相爱|结婚|未婚妻|未婚夫/u,
    关系描述: '恋人',
    好感度: 50,
    亲密关系: true,
  },
  {
    正则: /生死|挚友|至交|过命|救命恩人/u,
    关系描述: '生死挚友',
    好感度: 101,
    亲密关系: false,
  },
  {
    正则: /青梅竹马|发小|从小一起|一起长大|从小认识|自幼相识/u,
    关系描述: '青梅竹马',
    好感度: 50,
    亲密关系: false,
  },
  {
    正则: /知己|无话不谈|最信任/u,
    关系描述: '知己',
    好感度: 50,
    亲密关系: false,
  },
  {
    正则: /欠.*人情|恩人|救过|受过.*恩|人情债/u,
    关系描述: '欠人情',
    好感度: 25,
    亲密关系: false,
  },
  {
    正则: /师父|师傅|徒弟|弟子|师徒/u,
    关系描述: '师徒',
    好感度: 30,
    亲密关系: false,
  },
  {
    正则: /关系很好|关系不错|很要好|亲近|信任/u,
    关系描述: '熟识',
    好感度: 20,
    亲密关系: false,
  },
  {
    正则: /旧识|故人|老友|朋友|好友|熟人|相识|认识|同窗|同学|同事|搭档|战友|共事|合作|同伴|队友|一起/u,
    关系描述: '旧识',
    好感度: 20,
    亲密关系: false,
  },
];

const 否定正则 = /不认识|未曾相识|素未谋面|从未见过|没见过|只是听说|听说过|并不认识|不熟|没有见过/u;

const 无效人名 = new Set([
  '我们', '他们', '她们', '大家', '别人', '某人', '对方', '朋友', '伙伴', '同伴', '队友',
  '家人', '亲人', '世界', '命运', '过去', '以前', '自己', '玩家', '主角', '所有人',
]);

const 自定义人名模式: RegExp[] = [
  /(?:我的)?(?:妹妹|姐姐|哥哥|弟弟|朋友|好友|挚友|搭档|师父|师傅|徒弟|弟子|邻居|同学|同事|上司|下属|恋人|未婚妻|未婚夫|发小|青梅竹马)(?:叫|名叫|叫做|是)([\u4e00-\u9fa5A-Za-z·]{2,8})/gu,
  /(?:和|与|跟|同)([\u4e00-\u9fa5A-Za-z·]{2,8}?)(?:是|曾|一起|从小|共同|并肩|搭档|共事|相识|认识|相恋|相爱|结为|组成|合作|长大)/gu,
];

const 单句切分 = /[。！？!?；;\n]+/u;
const 证据长度上限 = 160;
const 种子数量上限 = 16;

/**
 * 从玩家写的旅人背景/开局文本里抽取“已经认识某角色”的种子。
 * 只认明确的关系线索，纯点名不算；否定句直接跳过。
 */
export function 提取前史关系种子(text: string | undefined, limit = 种子数量上限): 前史关系种子[] {
  const source = (text ?? '').trim();
  if (!source) return [];
  const found = new Map<string, 前史关系种子>();

  for (const rawSentence of source.split(单句切分)) {
    const sentence = rawSentence.trim();
    if (!sentence || 否定正则.test(sentence)) continue;
    const rule = 关系规则表.find((item) => item.正则.test(sentence));
    if (!rule) continue;

    for (const name of 查找句中人名(sentence)) {
      const canonical = matchCanonical(name);
      const displayName = canonical?.name ?? name;
      if (!isValidSeedName(displayName)) continue;
      const key = canonical?.name ?? displayName;
      const next: 前史关系种子 = {
        姓名: displayName,
        关系描述: rule.关系描述,
        好感度: rule.好感度,
        亲密关系: rule.亲密关系,
        证据: sentence.length > 证据长度上限 ? `${sentence.slice(0, 证据长度上限)}…` : sentence,
        原著角色: Boolean(canonical),
      };
      const current = found.get(key);
      if (!current) {
        found.set(key, next);
      } else {
        // 同一角色被多句提到时，保留好感绝对值更大的关系，证据则取更具体的一条。
        if (Math.abs(next.好感度) > Math.abs(current.好感度)) {
          found.set(key, { ...next, 证据: current.证据 === next.证据 ? next.证据 : `${current.证据}；${next.证据}` });
        } else if (current.证据 !== next.证据) {
          current.证据 = `${current.证据}；${next.证据}`;
        }
      }
    }
    if (found.size >= limit) break;
  }

  return [...found.values()].slice(0, limit);
}

/** 组合旅人背景与开局设定文本，供新局/旧档同步共用。 */
export function 收集前史关系文本(...parts: Array<string | undefined>): string {
  return parts.map((part) => (part ?? '').trim()).filter(Boolean).join('\n');
}

/**
 * 把种子合并进 NPC 列表：
 * - 已有同名/同原著角色时只补记忆、经历与亲密标记，不重复建人；
 * - 仅有“开局建立、尚未互动”的记录（初见回合 0）才接受种子好感度；
 * - 已经玩过的记录不覆盖当前好感，避免把动态关系打回设定值。
 */
export function 合并前史关系种子(records: NPC记录[], seeds: 前史关系种子[]): NPC记录[] {
  if (!seeds.length) return 归一化NPC记录列表(records);
  const merged = 归一化NPC记录列表(records);
  const byIdentity = new Map<string, NPC记录>();
  for (const record of merged) {
    byIdentity.set(关系身份键(record.姓名, record.别名), record);
  }

  for (const seed of seeds) {
    const key = 关系身份键(seed.姓名);
    const existing = byIdentity.get(key) ?? merged.find((record) => 关系身份键(record.姓名, record.别名) === key);
    if (!existing) {
      const record = 种子转NPC记录(seed);
      merged.push(record);
      byIdentity.set(key, record);
      continue;
    }

    if (existing.初见回合 <= 0) {
      existing.好感度 = seed.好感度;
    }
    existing.亲密关系 = existing.亲密关系 || seed.亲密关系;
    existing.关系 = 获取NPC兼容关系(existing.好感度);
    existing.当前关系阶段 = 获取NPC关系阶段(existing.好感度);
    if (seed.原著角色) existing.原著角色 = true;
    if (existing.阶位 !== 'companion' && (seed.原著角色 || seed.亲密关系)) existing.阶位 = 'companion';
    existing.同行记忆 = [...(existing.同行记忆 ?? []), ...种子记忆(seed)];
    existing.共同经历 = 去重文本([...(existing.共同经历 ?? []), seed.证据]);
    existing.备注 = 去重文本([...existing.备注, '来自旅人背景设定（前史）']);
    existing.必须记得 = 去重文本([
      ...(existing.必须记得 ?? []),
      '该关系来自旅人背景设定，是开局前已存在的关系；当前是否在场仍以正文为准。',
    ]);
    if (!existing.最近互动) existing.最近互动 = `前史：${seed.证据}`;
  }

  return 归一化NPC记录列表(merged);
}

function 种子转NPC记录(seed: 前史关系种子): NPC记录 {
  const canonical = matchCanonical(seed.姓名);
  const displayName = canonical?.name ?? seed.姓名;
  const record = 创建NPC记录({
    姓名: displayName,
    阶位: seed.原著角色 || seed.亲密关系 ? 'companion' : 'extra',
    初见回合: 0,
    原著角色: seed.原著角色,
    性别: canonical?.gender,
    外貌: canonical?.appearance,
    性格: canonical?.personality,
    介绍: `来自旅人背景设定的前史关系：${seed.关系描述}。`,
  });
  return {
    ...record,
    好感度: seed.好感度,
    关系: 获取NPC兼容关系(seed.好感度),
    亲密关系: seed.亲密关系,
    最近回合: 0,
    当前关系阶段: 获取NPC关系阶段(seed.好感度),
    最近互动: `前史：${seed.证据}`,
    共同经历: [seed.证据],
    同行记忆: 种子记忆(seed),
    备注: ['来自旅人背景设定（前史）'],
    必须记得: ['该关系来自旅人背景设定，是开局前已存在的关系；当前是否在场仍以正文为准。'],
  };
}

function 种子记忆(seed: 前史关系种子): NPC同行记忆条目[] {
  return [
    {
      id: `seed-memory-${seed.姓名}-${seed.好感度}`,
      回合: 0,
      摘要: `前史：${seed.证据}`.slice(0, 140),
      来源: '其他',
    },
  ];
}

function 查找句中人名(sentence: string): string[] {
  const names = new Set<string>();

  for (const character of CANONICAL_CHARACTERS) {
    const candidates = [character.name, ...(character.aliases ?? [])];
    if (candidates.some((name) => name.length >= 2 && sentence.includes(name))) {
      names.add(character.name);
    }
  }

  for (const pattern of 自定义人名模式) {
    pattern.lastIndex = 0;
    for (const match of sentence.matchAll(pattern)) {
      const name = match[1].trim();
      if (name) names.add(name);
    }
  }

  return [...names];
}

function 关系身份键(name: string, alias?: string): string {
  const canonical = matchCanonical(name) ?? (alias ? matchCanonical(alias) : null);
  return canonical?.name ?? name.trim();
}

function isValidSeedName(name: string): boolean {
  if (!name || name.length < 2 || name.length > 12) return false;
  if (无效人名.has(name)) return false;
  if (/^(?:我们|他们|她们|你们|咱们)/u.test(name)) return false;
  return true;
}

function 去重文本(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
