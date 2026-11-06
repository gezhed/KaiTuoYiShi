import { describe, expect, it } from 'vitest';
import { resolveLocalModelPath } from '@/services/memoryVector/modelPath';

describe('resolveLocalModelPath', () => {
  it('站点根目录部署', () => {
    expect(resolveLocalModelPath('/', 'https://example.com/assets/worker.js'))
      .toBe('https://example.com/models/');
  });

  it('子路径部署', () => {
    expect(resolveLocalModelPath('/KaiTuoYiShi/', 'https://example.com/KaiTuoYiShi/assets/worker.js'))
      .toBe('https://example.com/KaiTuoYiShi/models/');
  });

  it('相对 base 时从 worker 所在 assets 向上一级', () => {
    expect(resolveLocalModelPath('./', 'https://example.com/game/assets/worker.js'))
      .toBe('https://example.com/game/models/');
  });

  it('完整 CDN URL base', () => {
    expect(resolveLocalModelPath('https://cdn.example.com/app', 'https://example.com/assets/worker.js'))
      .toBe('https://cdn.example.com/app/models/');
  });
});
