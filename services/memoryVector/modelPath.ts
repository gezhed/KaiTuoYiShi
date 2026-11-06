/**
 * 计算内置模型的静态目录。
 *
 * `env.localModelPath` 不能写死 `/models/`，否则部署在子路径（例如
 * `https://example.com/KaiTuoYiShi/`）时会去域名根目录找模型。
 *
 * - 绝对 base（`/`、`/game/`）：按站点根拼接；
 * - 完整 URL base（CDN）：直接拼接；
 * - 相对 base（`./`）：worker 产物在 `assets/` 下，向上一级找 `models/`。
 */
export function resolveLocalModelPath(baseUrl: string, workerUrl: string): string {
  const base = (baseUrl || './').trim();

  if (/^https?:\/\//i.test(base)) {
    return new URL('models/', base.endsWith('/') ? base : `${base}/`).href;
  }

  if (base.startsWith('/')) {
    const origin = new URL(workerUrl).origin;
    const root = base.endsWith('/') ? base : `${base}/`;
    return new URL(`${root}models/`, origin).href;
  }

  return new URL('../models/', workerUrl).href;
}
