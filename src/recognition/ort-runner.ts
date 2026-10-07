import type { ModelRunner } from './engine';

/** The subset of the onnxruntime-web API we use (lets Node tests inject the same package). */
export interface OrtLike {
  InferenceSession: {
    create(model: Uint8Array | ArrayBuffer, options?: Record<string, unknown>): Promise<OrtSession>;
  };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
}
interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | ArrayLike<number> }>>;
  release?(): Promise<void>;
}

export interface ModelBytes {
  symbols: Uint8Array | ArrayBuffer;
  digits: Uint8Array | ArrayBuffer;
}

/**
 * Creates the two ONNX Runtime sessions (WASM backend, single thread — no SharedArrayBuffer /
 * cross-origin-isolation requirement, and the nets are tiny) and returns a ModelRunner.
 * Output/input names are discovered from the session so the code does not depend on exporter naming.
 */
export async function createOrtRunner(ort: OrtLike, models: ModelBytes): Promise<ModelRunner & { dispose(): Promise<void> }> {
  const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  const symbols = await ort.InferenceSession.create(models.symbols, opts);
  const digits = await ort.InferenceSession.create(models.digits, opts);

  const symIn = symbols.inputNames[0];
  const symOut = symbols.outputNames.includes('probs') ? 'probs' : symbols.outputNames[symbols.outputNames.length - 1];
  const digIn = digits.inputNames[0];
  const digOut = digits.outputNames[0];

  return {
    async symbols(batch, n) {
      const res = await symbols.run({ [symIn]: new ort.Tensor('float32', batch, [n, 3, 50, 50]) });
      return Float32Array.from(res[symOut].data as ArrayLike<number>);
    },
    async digit(grid) {
      const res = await digits.run({ [digIn]: new ort.Tensor('float32', grid, [1, 1, 28, 28]) });
      return Float32Array.from(res[digOut].data as ArrayLike<number>);
    },
    async dispose() {
      await symbols.release?.();
      await digits.release?.();
    },
  };
}
