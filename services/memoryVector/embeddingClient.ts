/**
 * 本地 embedding 客户端：懒加载 worker、串行化请求、超时与失败静默。
 *
 * 这是一个“可选增强”通道：模型没下载好、浏览器不支持 Worker、或推理超时，
 * 都只让本回合的向量召回缺席，绝不阻塞主剧情。
 */

export type MemoryEmbeddingStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PendingRequest {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
}

type WorkerResponse =
  | { id: number; ok: true; ready?: boolean; vectors?: Float32Array[]; dim?: number }
  | { id: number; ok: false; error: string };

let worker: Worker | null = null;
let activeModel = '';
let activeHost = '';
let status: MemoryEmbeddingStatus = 'idle';
let lastError = '';
let lastFailureAt = 0;
let loadPromise: Promise<void> | null = null;
let requestSeq = 0;
const pending = new Map<number, PendingRequest>();

export function getMemoryEmbeddingStatus(): { status: MemoryEmbeddingStatus; model: string; error: string } {
  return { status, model: activeModel, error: lastError };
}

/** 提前加载模型；不等待结果，失败也不抛给调用方。 */
export function warmupMemoryEmbedding(model: string, host?: string): void {
  void ensureWorker(model, host).catch(() => undefined);
}

export async function embedMemoryTexts(
  model: string,
  texts: string[],
  options: { signal?: AbortSignal; host?: string } = {},
): Promise<{ vectors: Float32Array[]; dim: number }> {
  const { signal, host } = options;
  const cleaned = texts.map((text) => text.trim()).filter(Boolean);
  if (!cleaned.length) return { vectors: [], dim: 0 };

  await ensureWorker(model, host);
  const response = await request({ type: 'embed', model, texts: cleaned }, 30_000, signal);
  if (!response.ok) throw new Error(response.error);
  return { vectors: response.vectors ?? [], dim: response.dim ?? 0 };
}

function ensureWorker(model: string, host = ''): Promise<void> {
  if (typeof Worker === 'undefined') {
    status = 'error';
    lastError = '当前环境不支持 Web Worker。';
    return Promise.reject(new Error(lastError));
  }
  // 下载/初始化失败后冷却一分钟再重试，避免每回合都重新拉一次模型。
  if (status === 'error' && activeModel === model && activeHost === host && Date.now() - lastFailureAt < 60_000) {
    return Promise.reject(new Error(lastError || '本地向量模型不可用。'));
  }
  if (worker && activeModel === model && activeHost === host) {
    if (status === 'ready') return Promise.resolve();
    if (status === 'error') return Promise.reject(new Error(lastError || '本地向量模型不可用。'));
    return loadPromise ?? Promise.resolve();
  }

  terminateWorker();
  activeModel = model;
  activeHost = host;
  status = 'loading';
  lastError = '';
  const created = new Worker(new URL('./embeddingWorker.ts', import.meta.url), { type: 'module' });
  worker = created;
  created.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    entry.resolve(response);
  };
  created.onerror = (event) => {
    failAll(new Error(event.message || '本地向量 worker 出错。'));
  };

  loadPromise = request({ type: 'warmup', model, host }, 180_000)
    .then((response) => {
      if (!response.ok) throw new Error(response.error);
      status = 'ready';
    })
    .catch((error: unknown) => {
      status = 'error';
      lastFailureAt = Date.now();
      lastError = error instanceof Error ? error.message : String(error);
      terminateWorker();
      throw error;
    })
    .finally(() => {
      loadPromise = null;
    });

  return loadPromise;
}

function request(
  payload: { type: 'warmup'; model: string; host?: string } | { type: 'embed'; model: string; texts: string[] },
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<WorkerResponse> {
  const target = worker;
  if (!target) return Promise.reject(new Error('本地向量 worker 尚未启动。'));
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));

  requestSeq += 1;
  const id = requestSeq;
  return new Promise<WorkerResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      pending.delete(id);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error('本地向量模型响应超时。')));
    }, timeoutMs);
    const onAbort = () => {
      finish(() => reject(new DOMException('Aborted', 'AbortError')));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, {
      resolve: (response) => finish(() => resolve(response)),
      reject: (error) => finish(() => reject(error)),
    });
    target.postMessage({ id, ...payload });
  });
}

function terminateWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  failAll(new Error('本地向量 worker 已重置。'));
}

function failAll(error: Error): void {
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}
