import type { TurnAfterReply, TurnContext, TurnDeltas } from './turnTypes';
import { buildImmediateMemory, addImmediateMemory, autoCompressMemorySystemWithArchivesAsync, type MemoryCompressionOutcome } from './memoryUtils';
import { 构建记忆事件FromReply, 封顶记忆事件 } from '@/models/memoryEvent';
import { 从事件派生角色记忆, 封顶角色记忆, 剪裁角色记忆, 记忆注入历史硬顶, type 记忆注入记录 } from '@/models/characterMemory';
import { 封顶幕记忆, 整理幕记忆 } from '@/models/memoryAct';
import { drainCharacterMemoryMarks } from '@/services/memoryCharacterRecall';
import { resolveApiConfig } from '@/services/apiConfig';
import { pushQueueTask } from './workflowTaskRuntime';

export async function stage6_memory(
  ctx: TurnContext,
  d: TurnAfterReply,
): Promise<Partial<TurnDeltas>> {
  const { state, userInput, abortController, assertWorkflowActive, turnCountAtStart, queueTasksMirror } = ctx;
  const parsedForDisplay = d.parsedForDisplay;
  const displayText = d.displayText;

  pushQueueTask(state, 'memory', 'pending', { detail: '正在写入即时记忆并检查压缩阈值。' }, turnCountAtStart, queueTasksMirror);

  const rawMemory = buildImmediateMemory(userInput, [
    parsedForDisplay.memory.trim() ? `本回合小结：${parsedForDisplay.memory.trim()}` : '',
    displayText,
  ].filter(Boolean).join('\n\n'));
  let mem = addImmediateMemory(state.记忆, rawMemory, turnCountAtStart);
  const compression = await autoCompressMemorySystemWithArchivesAsync(
    mem,
    turnCountAtStart,
    state.deviceSettings.gameSettings.记忆系统,
    resolveApiConfig(state.deviceSettings.apiSettings, state.deviceSettings.gameSettings, 'memoryCompression'),
    abortController.signal,
  );
  assertWorkflowActive();
  mem = compression.memory;

  const event = 构建记忆事件FromReply({
    turn: turnCountAtStart,
    thinking: parsedForDisplay.thinking,
    body: displayText,
    summary: parsedForDisplay.memory,
    worldTime: [state.世界.当前日期, state.世界.当前时间].filter(Boolean).join(' '),
    location: state.世界.当前地点,
    now: Date.now(),
  });
  if (event) {
    const events = 封顶记忆事件([...(mem.事件 ?? []), event]);
    const 排除角色 = [state.旅人.姓名, state.旅人.别名].filter(Boolean);
    const aliveLinks = 剪裁角色记忆(mem.角色记忆 ?? [], events);
    mem = {
      ...mem,
      事件: events,
      角色记忆: 封顶角色记忆([...aliveLinks, ...从事件派生角色记忆(event, 排除角色)]),
    };
  }

  const injectedMarks = drainCharacterMemoryMarks();
  if (injectedMarks.length) {
    const cutoff = turnCountAtStart - 60;
    const byKey = new Map<string, 记忆注入记录>();
    for (const record of mem.注入历史 ?? []) {
      if (record.回合 >= cutoff) byKey.set(`${record.事件ID}|${record.角色}`, record);
    }
    for (const mark of injectedMarks) {
      byKey.set(`${mark.事件ID}|${mark.角色}`, mark);
    }
    mem = { ...mem, 注入历史: [...byKey.values()].slice(-记忆注入历史硬顶) };
  }

  const 幕组号 = state.剧情编织.当前进度?.当前分段组号;
  if (typeof 幕组号 === 'number' && 幕组号 > 0) {
    const acts = mem.幕记忆 ?? [];
    const latest = acts.at(-1);
    if (!latest || latest.组号 !== 幕组号) {
      const previousGroup = latest?.组号 ?? Math.max(1, 幕组号 - 1);
      if (previousGroup < 幕组号) {
        const series = state.剧情编织.系列列表.find((item) => item.id === state.剧情编织.当前系列ID);
        const segment = series?.分段列表.find((item) => item.组号 === previousGroup);
        const title = segment?.标题.trim() || `第${previousGroup}幕`;
        const actResult = 整理幕记忆({
          events: mem.事件 ?? [],
          links: mem.角色记忆 ?? [],
          组号: previousGroup,
          标题: title,
          fromTurn: latest?.起止回合[1] ?? 0,
          currentTurn: turnCountAtStart,
          now: Date.now(),
        });
        if (actResult.act) {
          mem = {
            ...mem,
            幕记忆: 封顶幕记忆([...acts, actResult.act]),
            角色记忆: actResult.remainingLinks,
          };
        }
      }
    }
  }

  if (compression.failedDraft) {
    pushQueueTask(state, 'memory', 'failed', {
      detail: `记忆总结失败：${compression.failedDraft.failureMessage} 原始批次已保存为失败草稿，可在记忆面板重试或忽略。`,
      failCount: 1,
    }, turnCountAtStart, queueTasksMirror);
  } else {
    pushQueueTask(state, 'memory', 'success', {
      detail: 整理成功说明(compression),
    }, turnCountAtStart, queueTasksMirror);
  }

  return { mem, yitingWithCompression: state.忆庭 };
}

function 整理成功说明(compression: MemoryCompressionOutcome): string {
  if (compression.draftSkipped) return '本批记忆材料超出草稿快照边界，已使用本地摘要完成整理。';
  if (compression.usedModel) return '即时/短期/中期/长期记忆已调用记忆总结 API 完成整理。';
  return '即时/短期/中期/长期记忆已使用本地摘要完成整理。';
}
