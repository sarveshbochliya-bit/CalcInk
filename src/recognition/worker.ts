/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { RecognitionEngine } from './engine';
import { createOrtRunner, type OrtLike } from './ort-runner';
import type { InputStroke, RecognitionResult } from './types';

/**
 * Recognition worker. Everything heavy happens here, off the UI thread:
 * segmentation, rasterisation, ONNX Runtime inference, fusion.
 *
 * Protocol (all messages are plain objects):
 *   main → worker   { type:'init', symbolsUrl, digitsUrl }
 *                   { type:'recognize', id, strokes: InputStroke[] }   (point buffers are transferred)
 *                   { type:'reset' }                                    (drop the symbol cache)
 *   worker → main   { type:'ready', ms }
 *                   { type:'result', id, result }
 *                   { type:'error', id?, message }
 */
export type WorkerRequest =
  | { type: 'init'; symbolsUrl: string; digitsUrl: string }
  | { type: 'recognize'; id: number; strokes: InputStroke[] }
  | { type: 'reset' };

export type WorkerResponse =
  | { type: 'ready'; ms: number }
  | { type: 'result'; id: number; result: RecognitionResult }
  | { type: 'error'; id?: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let engine: RecognitionEngine | null = null;
let dispose: (() => Promise<void>) | null = null;

const post = (msg: WorkerResponse) => ctx.postMessage(msg);

async function load(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.arrayBuffer();
}

async function init(symbolsUrl: string, digitsUrl: string) {
  const t0 = performance.now();
  // The WASM binary is a bundled, hashed asset (precached by the service worker) — never a CDN.
  ort.env.wasm.wasmPaths = { wasm: wasmUrl } as unknown as string;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const [symbols, digits] = await Promise.all([load(symbolsUrl), load(digitsUrl)]);
  const runner = await createOrtRunner(ort as unknown as OrtLike, { symbols, digits });
  engine = new RecognitionEngine(runner);
  dispose = runner.dispose;
  // Warm-up: first inference JIT-compiles kernels; do it before the user's first equation.
  const pts = new Float32Array(20 * 3);
  for (let i = 0; i < 20; i++) pts.set([10 + i, 10 + (i % 7) * 3, 0.5], i * 3);
  await engine.recognize([{ id: -1, pts }]);
  engine.clearCache();
  post({ type: 'ready', ms: performance.now() - t0 });
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      await init(msg.symbolsUrl, msg.digitsUrl);
    } else if (msg.type === 'recognize') {
      if (!engine) throw new Error('Recognition engine is not ready');
      const result = await engine.recognize(msg.strokes);
      post({ type: 'result', id: msg.id, result });
    } else if (msg.type === 'reset') {
      engine?.clearCache();
    }
  } catch (err) {
    post({ type: 'error', id: msg.type === 'recognize' ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};

ctx.addEventListener('close', () => void dispose?.());
