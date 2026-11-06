/// <reference lib="webworker" />
/**
 * 本地 embedding 模型 worker。
 *
 * 模型只在浏览器里跑（onnxruntime-web + transformers.js），首次启用时会从
 * Hugging Face 下载量化模型并缓存到浏览器；之后离线可用。这里不接触存档，
 * 只把文本转成归一化向量。
 */
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { resolveLocalModelPath } from './modelPath';

env.allowLocalModels = true;
env.localModelPath = resolveLocalModelPath(import.meta.env.BASE_URL, self.location.href);
env.useBrowserCache = true;
// 不依赖 SharedArrayBuffer / crossOriginIsolated，单线程最稳。
const wasmBackend = (env.backends as { onnx?: { wasm?: { numThreads?: number } } } | undefined)?.onnx?.wasm;
if (wasmBackend) wasmBackend.numThreads = 1;

type EmbeddingRequest =
  | { id: number; type: 'warmup'; model: string; host?: string }
  | { id: number; type: 'embed'; model: string; texts: string[] };

type EmbeddingResponse =
  | { id: number; ok: true; ready?: boolean; vectors?: Float32Array[]; dim?: number }
  | { id: number; ok: false; error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<EmbeddingRequest>) => void) | null;
  postMessage: (message: EmbeddingResponse, transfer?: Transferable[]) => void;
};

let currentModel = '';
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
let chain: Promise<void> = Promise.resolve();

async function getExtractor(model: string, host = ''): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise || currentModel !== model) {
    currentModel = model;
    if (host) env.remoteHost = host;
    extractorPromise = pipeline('feature-extraction', model, {
      dtype: 'q8',
      device: 'wasm',
    }).catch((error: unknown) => {
      // 失败不缓存 rejected promise：下次请求/预热可以重新下载。
      extractorPromise = null;
      currentModel = '';
      throw error;
    });
  }
  return extractorPromise;
}

async function handle(request: EmbeddingRequest): Promise<void> {
  try {
    const extractor = await getExtractor(request.model, request.type === 'warmup' ? request.host : undefined);
    if (request.type === 'warmup') {
      scope.postMessage({ id: request.id, ok: true, ready: true });
      return;
    }

    const texts = request.texts.map((text) => text.trim()).filter(Boolean);
    if (!texts.length) {
      scope.postMessage({ id: request.id, ok: true, vectors: [], dim: 0 });
      return;
    }

    const output = await extractor(texts, { pooling: 'cls', normalize: true });
    const data = Float32Array.from(output.data);
    const dims = output.dims;
    const dim = dims[dims.length - 1] ?? 0;
    if (!dim) throw new Error('模型没有返回有效维度。');

    const vectors: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 1) {
      vectors.push(data.slice(i * dim, (i + 1) * dim));
    }
    scope.postMessage(
      { id: request.id, ok: true, vectors, dim },
      vectors.map((vector) => vector.buffer),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scope.postMessage({ id: request.id, ok: false, error: message });
  }
}

scope.onmessage = (event: MessageEvent<EmbeddingRequest>) => {
  chain = chain.then(() => handle(event.data));
};
