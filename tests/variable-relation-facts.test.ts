import { describe, expect, it } from 'vitest';
import { 创建NPC记录 } from '@/models/npc';
import { parseVariableFacts, factsToVariableCommands } from '@/utils/variableFacts';
import type { VariableState } from '@/utils/variableRegistry';

describe('variable npc_relation facts', () => {
  it('解析角色关系事实', () => {
    const { facts, parseErrors } = parseVariableFacts(`<变量事实>
[
  {"type":"npc_relation","from":"三月七","to":"星","relation":"闺蜜","stage":"挚友","reason":"一起经历列车危机","evidence":"正文写两人以闺蜜相称"}
]
</变量事实>`);
    expect(parseErrors).toEqual([]);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      type: 'npc_relation',
      from: '三月七',
      to: '星',
      relation: '闺蜜',
      stage: '挚友',
    });
  });

  it('生成关系脉络 set 命令', () => {
    const march = 创建NPC记录({ 姓名: '三月七', 初见回合: 0, 阶位: 'companion' });
    const state = {
      NPC: [march],
      世界: {},
    } as unknown as VariableState;
    const { facts } = parseVariableFacts(`<变量事实>
[{"type":"npc_relation","from":"三月七","to":"星","relation":"同一后宫的姐妹","stage":"亲密","reason":"达成共识"}]
</变量事实>`);
    const { commands, warnings } = factsToVariableCommands(facts, state, 12);
    expect(warnings).toEqual([]);
    const command = commands.find((item) => item.key.endsWith('.关系脉络'));
    expect(command?.action).toBe('set');
    expect(command?.key).toBe(`NPC[id=${march.id}].关系脉络`);
    expect(command?.value).toMatchObject([{ 目标姓名: '星', 关系: '同一后宫的姐妹', 阶段: '亲密', 来源: 'AI' }]);
  });

  it('找不到发起人时跳过并给出 warning', () => {
    const state = { NPC: [], 世界: {} } as unknown as VariableState;
    const { facts } = parseVariableFacts(`<变量事实>
[{"type":"npc_relation","from":"不存在","to":"星","relation":"旧识"}]
</变量事实>`);
    const { commands, warnings } = factsToVariableCommands(facts, state, 3);
    expect(commands).toHaveLength(0);
    expect(warnings[0]).toContain('找不到关系发起人');
  });
});
