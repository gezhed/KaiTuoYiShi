import { describe, expect, it } from 'vitest';
import { 是疑似人物姓名 } from '@/models/npc';

describe('是疑似人物姓名', () => {
  it('接受常见人物名', () => {
    expect(是疑似人物姓名('三月七')).toBe(true);
    expect(是疑似人物姓名('丹恒')).toBe(true);
    expect(是疑似人物姓名('小雨')).toBe(true);
    expect(是疑似人物姓名('Lyra')).toBe(true);
    expect(是疑似人物姓名('阿基维利')).toBe(true);
  });

  it('拒绝地点、物品、群体与系统词', () => {
    expect(是疑似人物姓名('众人')).toBe(false);
    expect(是疑似人物姓名('系统')).toBe(false);
    expect(是疑似人物姓名('门')).toBe(false);
    expect(是疑似人物姓名('走廊')).toBe(false);
    expect(是疑似人物姓名('空气')).toBe(false);
    expect(是疑似人物姓名('某个声音')).toBe(false);
    expect(是疑似人物姓名('他们')).toBe(false);
  });

  it('拒绝感官描写与句子片段', () => {
    expect(是疑似人物姓名('他的声音')).toBe(false);
    expect(是疑似人物姓名('门后的人影')).toBe(false);
    expect(是疑似人物姓名('她抬起头，看了你一眼')).toBe(false);
    expect(是疑似人物姓名('第3回合的判定')).toBe(false);
  });

  it('拒绝空白、纯数字与超长字符串', () => {
    expect(是疑似人物姓名('')).toBe(false);
    expect(是疑似人物姓名('12345')).toBe(false);
    expect(是疑似人物姓名('这是一个明显超过十二个字符的所谓人物名字')).toBe(false);
    expect(是疑似人物姓名('三月 七')).toBe(false);
  });
});
