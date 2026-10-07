import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ort from 'onnxruntime-web';
import { RecognitionEngine } from '../../src/recognition/engine';
import { createOrtRunner, type OrtLike } from '../../src/recognition/ort-runner';

const models = (name: string) => readFileSync(resolve(__dirname, '../../public/models', name));

let cachedRunner: ReturnType<typeof createOrtRunner> | null = null;
export function realRunner() {
  ort.env.wasm.numThreads = 1;
  cachedRunner ??= createOrtRunner(ort as unknown as OrtLike, {
    symbols: models('symbols16.onnx'),
    digits: models('digits_mnist.onnx'),
  });
  return cachedRunner;
}

let cached: Promise<RecognitionEngine> | null = null;

/** The real engine with the real ONNX models, running on ONNX Runtime's WASM backend in Node. */
export function realEngine(): Promise<RecognitionEngine> {
  cached ??= (async () => {
    return new RecognitionEngine(await realRunner());
  })();
  return cached;
}
