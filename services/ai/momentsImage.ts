import type { 文生图系统设置 } from '@/models/genSystem';
import type { 朋友圈图片 } from '@/models/moments';
import { 构建朋友圈配图提示词, 朋友圈图片字符上限 } from '@/models/moments';
import { 生成单张插图, 重写提示词标记 } from '@/services/ai/imageGen/generateIllustration';

/** 朋友圈配图最多保留的宽度；再大对手机卡片没有意义，只会撑大存档。 */
const 朋友圈图片最大宽度 = 720;
const 朋友圈图片质量 = 0.82;

export function 朋友圈生图可用(设置: 文生图系统设置 | undefined): boolean {
  return Boolean(设置?.启用);
}

/**
 * 把出图结果压成适合塞进存档的 data URL。
 *
 * 朋友圈图片会直接写进手机状态，不能像正文插图那样只存 `asset:` 引用，
 * 所以这里必须自己控制体积；canvas 不可用（比如测试环境）时保留原图。
 */
async function 压缩朋友圈图片(
  数据地址: string,
  原宽: number,
  原高: number,
): Promise<朋友圈图片 | undefined> {
  if (!数据地址.startsWith('data:image/')) return undefined;
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return { 数据地址, 宽度: 原宽, 高度: 原高 };
  }
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const 宽 = Math.max(1, image.naturalWidth || 原宽 || 1);
        const 高 = Math.max(1, image.naturalHeight || 原高 || 1);
        const 缩放 = Math.min(1, 朋友圈图片最大宽度 / 宽);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(宽 * 缩放));
        canvas.height = Math.max(1, Math.round(高 * 缩放));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ 数据地址, 宽度: 宽, 高度: 高 });
          return;
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const 压缩 = canvas.toDataURL('image/jpeg', 朋友圈图片质量);
        if (!压缩.startsWith('data:image/') || 压缩.length > 朋友圈图片字符上限) {
          resolve(undefined);
          return;
        }
        resolve({ 数据地址: 压缩, 宽度: canvas.width, 高度: canvas.height });
      } catch {
        resolve(undefined);
      }
    };
    image.onerror = () => resolve(undefined);
    image.src = 数据地址;
  });
}

export interface 朋友圈配图请求 {
  设置: 文生图系统设置;
  作者姓名: string;
  描述: string;
  signal?: AbortSignal;
}

/**
 * 生成一张朋友圈配图。
 *
 * 调用方负责“要不要生成”和失败兜底；这里只把出图链路的异常原样抛出，
 * 方便工作流把失败原因写进队列诊断，而不是静默变成一张没有图的动态。
 */
export async function 生成朋友圈配图(
  请求: 朋友圈配图请求,
): Promise<朋友圈图片 | undefined> {
  if (!朋友圈生图可用(请求.设置)) return undefined;
  const 描述 = 请求.描述.trim();
  if (!描述) return undefined;

  const 结果 = await 生成单张插图(
    请求.设置,
    {
      提示词标记: 重写提示词标记(构建朋友圈配图提示词(请求.作者姓名, 描述)),
      标题: '朋友圈配图',
      写缓存: false,
      signal: 请求.signal,
    },
    {
      启用列表: 请求.设置.角色启用列表,
      全部角色: 请求.设置.角色卡,
    },
  );

  const 数据地址 = 结果.结果.数据地址;
  if (!数据地址) return undefined;
  return 压缩朋友圈图片(数据地址, 结果.结果.宽度, 结果.结果.高度);
}
