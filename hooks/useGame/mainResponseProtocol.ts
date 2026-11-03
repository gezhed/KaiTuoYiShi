import type { 解析后回复 } from '@/models/chat';
import type { 世界状态 } from '@/models/world';

export const DEEPSEEK_MAIN_FORMAT_GUARD = [
  'DeepSeek 主剧情格式校验：本轮必须从 <thinking> 开始输出，禁止直接从 <正文> 开始。',
  '必须完整输出 <thinking>、<正文>、<短期记忆>、<动态世界>、<变量草稿>；如本回合存在后续承接价值，再输出 <剧情规划>。',
  '<thinking> 内必须按当前生效的思维链 Step 标题，用中文逐步写出实际判断；不允许只写正文，不允许省略 thinking，不允许只写“已思考”。',
  '不要在标签外输出解释、道歉、说明或额外标题。',
].join('\n');

/** 默认格式校验标签；用户开关打开但没填标签时也按这套检查，避免“开了等于没开”。 */
export const DEFAULT_REQUIRED_RESPONSE_TAGS = ['正文', '短期记忆', '动态世界', '变量草稿'];
export const DEFAULT_REQUIRED_RESPONSE_TAGS_TEXT = '<正文>\n<短期记忆>\n<动态世界>\n<变量草稿>';

export function formatOriginalProtagonistForOpening(originalProtagonist: 世界状态['原著主角']): string {
  if (originalProtagonist === '星') return '原作主角星';
  if (originalProtagonist === '穹') return '原作主角穹';
  if (originalProtagonist === '星穹双主角') return '原作主角星与穹';
  return '所选原著主角';
}

function hasProtocolTag(rawText: string, tagNames: string[]): boolean {
  return tagNames.some((tag) => {
    const escaped = tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

    return new RegExp(`<\\s*${escaped}\\s*>`, 'i').test(rawText);
  });
}

/**
 * 用户填写的「必需标签」→ 干净标签名。
 *
 * 允许 `正文`、`<正文>`、`</正文>`、`<正文 >` 混写；逗号 / 分号 / 换行 / 空格都能分隔。
 * 只保留合法的标签名（不含空白、尖括号、斜杠），避免拼进正则时把规则弄坏。
 */
export function 解析必需标签(input: string | null | undefined): string[] {
  const 结果: string[] = [];
  const 已见 = new Set<string>();
  const 片段列表 = (input ?? '')
    .split(/[,，;；\n\r]+/)
    .flatMap((段) => {
      const 带尖括号 = 段.match(/<[^<>]*>/g) ?? [];
      const 剩余 = 段.replace(/<[^<>]*>/g, ' ').trim();
      return [...带尖括号, ...(剩余 ? 剩余.split(/\s+/) : [])];
    });
  for (const 片段 of 片段列表) {
    const 标签 = 片段
      .trim()
      .replace(/^<\s*\/?\s*/, '')
      .replace(/\s*\/?>\s*$/, '')
      .trim();
    if (!标签 || /[\s<>/]/.test(标签)) continue;
    const 键 = 标签.toLowerCase();
    if (已见.has(键)) continue;
    已见.add(键);
    结果.push(标签);
  }
  return 结果;
}

/** 原始输出里缺少哪些必需标签（只看开标签；允许 `<标签 属性>`）。 */
export function 取缺失必需标签(rawText: string, requiredTags: readonly string[]): string[] {
  const raw = rawText || '';
  return requiredTags.filter((tag) => {
    const escaped = tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    return !new RegExp(`<\\s*${escaped}(?:\\s[^>]*)?>`, 'i').test(raw);
  });
}

/** 缺少必需标签时的重写指令。要求整段重写，避免模型只补一个空标签交差。 */
export function buildRequiredTagRetryGuard(missingTags: readonly string[]): string {
  const 标签串 = missingTags.map((tag) => `<${tag}>`).join('、');
  return [
    '正文格式自动重试：上一版原始输出缺少用户指定的必需 XML 标签。',
    `缺少：${标签串}。`,
    '请完全重写本回合回复，保留已发生的剧情事实，不要只补标签、不要续写上一版残缺输出。',
    `重写后必须包含：${标签串}；这些标签要作为顶层标签出现，标签外不要写解释或道歉。`,
  ].join('\n');
}

export function buildOutputTruncatedRetryGuard(finishReason: string): string {
  return [
    '正文格式自动重试：上一版输出因长度上限被截断。',
    `finishReason=${finishReason}。`,
    '请完全重写本回合回复：保留已发生事实，压缩重复描写，确保正文完整收束，并在正文后完整输出所有必需标签。',
    '不要把结尾停在半句话，不要输出“未完待续”。',
  ].join('\n');
}

export function getDeepSeekMainProtocolIssues(parsed: 解析后回复, rawText: string): string[] {
  const raw = rawText || parsed.rawText || '';
  const issues: string[] = [];
  if (!hasProtocolTag(raw, ['thinking', 'think', '思考']) || !parsed.thinking.trim()) {
    issues.push('缺少 <thinking> 或 thinking 为空');
  } else if (
    !/(?:^|\n)\s*(?:Step|Opening-Step|Awakening-Step|步骤)\s*0?\d/i.test(parsed.thinking) &&
    !/Step(?:0|1|2|3|4|5|6|7|8|9|10|11|12|13|14)/i.test(parsed.thinking)
  ) {
    issues.push('<thinking> 未按 Step 思维链展开');
  }
  if (!hasProtocolTag(raw, ['正文', 'body', 'content', 'text', '内容']) || !parsed.body.trim()) {
    issues.push('缺少 <正文> 或正文为空');
  }
  if (!hasProtocolTag(raw, ['短期记忆', 'memory', 'summary', 'recap', '记忆', '回忆'])) {
    issues.push('缺少 <短期记忆>');
  }
  if (!hasProtocolTag(raw, ['动态世界', 'world', 'worldevent', '世界', '事件'])) {
    issues.push('缺少 <动态世界>');
  }
  if (!hasProtocolTag(raw, ['变量草稿', 'variableDraft', '变量候选', '变量线索', '变量摘要'])) {
    issues.push('缺少 <变量草稿>');
  }
  return issues;
}

export function buildDeepSeekProtocolRetryGuard(issues: string[]): string {
  return [
    'DeepSeek 主剧情自动重试：上一版输出未通过协议校验。',
    `失败项：${issues.join('；') || '未知格式错误'}。`,
    '请完全重写，不要延续上一版残缺输出。',
    DEEPSEEK_MAIN_FORMAT_GUARD,
  ].join('\n');
}

export function stripLeakedHistoryMetaFromBody(body: string): string {
  if (!body) return body;
  return body
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim();
      if (!line) return raw;
      const historyTag = line.match(/^【\s*(历史时间|历史正文|历史狭间问答|历史狭间评判|历史短期记忆|历史变量草稿|历史剧情规划)\s*】\s*(.*)$/);
      if (!historyTag) return raw;
      const [, tag, rest] = historyTag;
      if (tag === '历史时间') return '';
      return rest.trim() ? `【旁白】${rest.trim()}` : '';
    })
    .filter((line) => line.trim())
    .join('\n');
}

export const COT_FAKE_HISTORY_USER = '开始任务';
export const COT_FAKE_HISTORY_ASSISTANT = `<thinking>
思考已开始，按当前生效思维链继续逐步推演。
</thinking>
好的，将以<正文></正文>包裹正文，<正文>前以<thinking>作为开头进行思考并以</thinking>闭合，并在正文后按协议输出<短期记忆>、<动态世界>、<变量草稿>、<剧情规划>：`;

export function isDeepSeekMainConfig(config: { provider?: string; baseUrl?: string; model?: string }): boolean {
  const provider = (config.provider ?? '').toLowerCase();
  const baseUrl = (config.baseUrl ?? '').toLowerCase();
  const model = (config.model ?? '').toLowerCase();
  return provider === 'deepseek' || baseUrl.includes('deepseek') || model.includes('deepseek');
}
