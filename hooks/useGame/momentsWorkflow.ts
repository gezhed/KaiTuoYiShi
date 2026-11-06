import type { TurnContext } from './turnTypes';
import type { 手机系统 } from '@/models/phone';
import type { NPC记录 } from '@/models/npc';
import type { 记忆系统 } from '@/models/memory';
import type { 朋友圈动态 } from '@/models/moments';
import {
  创建朋友圈动态,
  选取朋友圈作者,
  收集朋友圈知情角色,
  封顶朋友圈动态,
  构建朋友圈记忆事件,
  归一化朋友圈动态,
  计算朋友圈下次回合,
} from '@/models/moments';
import { 封顶记忆事件 } from '@/models/memoryEvent';
import { 从事件派生角色记忆, 封顶角色记忆, 剪裁角色记忆 } from '@/models/characterMemory';
import { buildPhoneApiConfig } from '@/services/ai/phoneService';
import { generateMoments } from '@/services/ai/momentsService';
import { 生成朋友圈配图, 朋友圈生图可用 } from '@/services/ai/momentsImage';
import { pushQueueTask } from './workflowTaskRuntime';

function 文本提到(text: string, npc: NPC记录): boolean {
  const names = [npc.姓名, npc.别名].filter((name): name is string => Boolean(name?.trim()));
  return names.some((name) => text.includes(name.trim()));
}

/** 在场判定：同行、本回合刚互动、或正文点名。宁可少发，也不让在场角色“隔空发朋友圈”。 */
function 收集在场姓名(npcs: NPC记录[], displayText: string, turn: number): string[] {
  const names = new Set<string>();
  for (const npc of npcs) {
    const onStage = npc.同行 || npc.最近回合 >= turn - 1 || 文本提到(displayText, npc);
    if (onStage) {
      names.add(npc.姓名);
      if (npc.别名) names.add(npc.别名);
    }
  }
  return [...names];
}

function 合并记忆(
  memory: 记忆系统,
  moments: 朋友圈动态[],
  travelerNames: string[],
): 记忆系统 {
  const 新事件 = moments.map((moment) => 构建朋友圈记忆事件({ moment }));
  const 事件 = 封顶记忆事件([...(memory.事件 ?? []), ...新事件]);
  const 存活事件 = new Set(事件.map((event) => event.id));
  const 排除 = travelerNames.filter(Boolean);
  const 新链接 = 新事件.flatMap((event) => 从事件派生角色记忆(event, 排除));
  const 链接 = 剪裁角色记忆(
    [...(memory.角色记忆 ?? []), ...新链接].filter((link) => 存活事件.has(link.事件ID)),
    [...(memory.事件 ?? []), ...新事件],
  );
  return {
    ...memory,
    事件,
    角色记忆: 封顶角色记忆(链接),
  };
}

export interface MomentsJobParams {
  state: TurnContext['state'];
  phone: 手机系统;
  npcs: NPC记录[];
  turn: number;
  displayText: string;
  userInput: string;
  abortController: AbortController;
  skip: boolean;
  assertWorkflowActive: () => void;
  turnCountAtStart: number;
  queueTasksMirror: TurnContext['queueTasksMirror'];
}

export interface MomentsJobResult {
  phoneAfterMoments?: 手机系统;
  memoryAfterMoments?: 记忆系统;
}

/**
 * 朋友圈回合任务。
 *
 * 只在“到点”时尝试；没有合适作者、API 不可用或生成失败时，只把下次回合往后推，
 * 不让一个附加功能把整个回合标红。
 */
export async function runMomentsJob(p: MomentsJobParams): Promise<MomentsJobResult> {
  const phoneSettings = p.state.deviceSettings.gameSettings.手机系统;
  if (!phoneSettings.enabled || !phoneSettings.朋友圈启用 || p.skip) return {};

  const phone = p.phone;
  const turn = p.turnCountAtStart + 1;
  const minGap = Math.max(1, Math.min(10, Math.trunc(phoneSettings.朋友圈间隔最小) || 3));
  const maxGap = Math.max(minGap, Math.min(10, Math.trunc(phoneSettings.朋友圈间隔最大) || 5));
  if (!phone.朋友圈下次回合) {
    return { phoneAfterMoments: { ...phone, 朋友圈下次回合: 计算朋友圈下次回合(turn, minGap, maxGap) } };
  }
  if (turn < phone.朋友圈下次回合) return {};

  const present = 收集在场姓名(p.npcs, p.displayText, turn);
  const recentAuthors = (phone.朋友圈动态 ?? [])
    .filter((moment) => turn - moment.回合 <= 8)
    .map((moment) => moment.作者姓名);
  const authors = 选取朋友圈作者({
    contacts: phone.contacts,
    npcs: p.npcs,
    presentNames: present,
    min: Math.max(1, Math.min(4, Math.trunc(phoneSettings.朋友圈人数最小) || 2)),
    max: Math.max(1, Math.min(6, Math.trunc(phoneSettings.朋友圈人数最大) || 4)),
    recentAuthors,
  });
  const nextTurn = 计算朋友圈下次回合(turn, minGap, maxGap);
  if (!authors.length) {
    return { phoneAfterMoments: { ...phone, 朋友圈下次回合: nextTurn } };
  }

  const config = buildPhoneApiConfig(p.state.deviceSettings.gameSettings, p.state.deviceSettings.apiSettings);
  if (!config) {
    pushQueueTask(p.state, 'phone', 'skipped', {
      detail: '朋友圈已到点，但没有可用的手机 API。',
    }, p.turnCountAtStart, p.queueTasksMirror);
    return { phoneAfterMoments: { ...phone, 朋友圈下次回合: nextTurn } };
  }

  pushQueueTask(p.state, 'phone', 'pending', {
    detail: `正在生成朋友圈（${authors.map((npc) => npc.姓名).join('、')}）…`,
  }, p.turnCountAtStart, p.queueTasksMirror);

  try {
    const 条目 = await generateMoments(config, {
      authors,
      recentPosts: (phone.朋友圈动态 ?? []).slice(-6),
      turn,
      travelerName: p.state.旅人.姓名,
      location: p.state.世界.当前地点,
      time: p.state.世界.当前时间,
    }, p.abortController.signal);
    p.assertWorkflowActive();

    if (!条目.length) {
      pushQueueTask(p.state, 'phone', 'skipped', {
        detail: '朋友圈本回合没有生成有效内容。',
      }, p.turnCountAtStart, p.queueTasksMirror);
      return { phoneAfterMoments: { ...phone, 朋友圈下次回合: nextTurn } };
    }

    const byName = new Map(authors.map((npc) => [npc.姓名, npc]));
    const moments = 条目
      .map((item) => {
        const author = byName.get(item.作者);
        if (!author) return null;
        return 创建朋友圈动态({
          author,
          content: item.内容,
          turn,
          audience: 收集朋友圈知情角色(author, p.npcs),
          配图: item.配图,
        });
      })
      .filter((moment): moment is 朋友圈动态 => Boolean(moment));

    // 只给本批其中一条动态配图：朋友圈是补充内容，不值得一次烧四张图。
    const 文生图 = p.state.deviceSettings.gameSettings.文生图系统;
    const 配图下标 = moments.findIndex((moment) => Boolean(moment.配图));
    if (phoneSettings.朋友圈生图启用 && 配图下标 >= 0 && 朋友圈生图可用(文生图)) {
      const 目标 = moments[配图下标];
      pushQueueTask(p.state, 'phone', 'pending', {
        detail: '正在生成朋友圈配图…',
      }, p.turnCountAtStart, p.queueTasksMirror);
      try {
        const 图片 = await 生成朋友圈配图({
          设置: 文生图,
          作者姓名: 目标.作者姓名,
          描述: 目标.配图 ?? '',
          signal: p.abortController.signal,
        });
        if (图片) moments[配图下标] = { ...目标, 图片 };
      } catch (error) {
        if (p.abortController.signal.aborted) throw error;
        pushQueueTask(p.state, 'phone', 'failed', {
          detail: `朋友圈配图生成失败，已保留文字动态：${error instanceof Error ? error.message : String(error)}`,
        }, p.turnCountAtStart, p.queueTasksMirror);
      }
      p.assertWorkflowActive();
    }

    const 动态 = 封顶朋友圈动态([...(phone.朋友圈动态 ?? []), ...moments]);
    const phoneAfterMoments: 手机系统 = {
      ...phone,
      朋友圈动态: 归一化朋友圈动态(动态),
      朋友圈下次回合: nextTurn,
    };

    let memoryAfterMoments: 记忆系统 | undefined;
    if (phoneSettings.朋友圈并入记忆) {
      const travelerNames = [p.state.旅人.姓名, p.state.旅人.别名].filter((name): name is string => Boolean(name.trim()));
      memoryAfterMoments = 合并记忆(p.state.记忆, moments, travelerNames);
    }

    pushQueueTask(p.state, 'phone', 'success', {
      detail: `朋友圈已更新：${moments.map((moment) => moment.作者姓名).join('、')}。`,
    }, p.turnCountAtStart, p.queueTasksMirror);
    return { phoneAfterMoments, memoryAfterMoments };
  } catch (error) {
    if (p.abortController.signal.aborted) throw error;
    pushQueueTask(p.state, 'phone', 'failed', {
      detail: `朋友圈生成失败：${error instanceof Error ? error.message : String(error)}`,
    }, p.turnCountAtStart, p.queueTasksMirror);
    return { phoneAfterMoments: { ...phone, 朋友圈下次回合: turn + 2 } };
  }
}
