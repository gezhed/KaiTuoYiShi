import { describe, expect, it } from 'vitest';
import { 创建空相册系统 } from '@/models/imageGeneration';
import { 合并相册系统 } from '@/utils/albumActions';

function 造资产(id: string) {
  return { id, source: 'generated' as const, nsfw: false, createdAt: 0, status: 'ready' as const };
}

function 造条目(id: string, assetId: string) {
  return {
    id,
    assetId,
    title: id,
    targetType: 'scene' as const,
    slot: 'scene' as const,
    tags: [],
    nsfw: false,
    createdAt: 0,
    referenceTargets: [],
  };
}

describe('合并相册系统', () => {
  it('保留当前相册和本次新增，按 id 去重', () => {
    const 当前 = 创建空相册系统();
    当前.assets.push(造资产('old'));
    当前.entries.push(造条目('old_entry', 'old'));
    const 新 = 创建空相册系统();
    新.assets.push(造资产('old'), 造资产('new'));
    新.entries.push(造条目('old_entry', 'old'), 造条目('new_entry', 'new'));

    const 合并 = 合并相册系统(当前, 新);
    expect(合并.assets.map((项) => 项.id)).toEqual(['old', 'new']);
    expect(合并.entries.map((项) => 项.id)).toEqual(['old_entry', 'new_entry']);
  });

  it('本次快照没带旧图时，当前相册里的旧图不会被抹掉', () => {
    const 当前 = 创建空相册系统();
    当前.assets.push(造资产('old'), 造资产('previous_new'));
    当前.entries.push(造条目('old_entry', 'old'), 造条目('previous_new_entry', 'previous_new'));
    const 新 = 创建空相册系统();
    新.assets.push(造资产('current_new'));
    新.entries.push(造条目('current_new_entry', 'current_new'));

    const 合并 = 合并相册系统(当前, 新);
    expect(合并.assets.map((项) => 项.id).sort()).toEqual(['current_new', 'old', 'previous_new']);
    expect(合并.entries.map((项) => 项.id).sort()).toEqual(['current_new_entry', 'old_entry', 'previous_new_entry']);
  });
});
