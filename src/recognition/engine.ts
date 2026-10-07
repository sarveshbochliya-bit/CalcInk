import { featuresOf, fuse, softmax } from './classifier';
import { MNIST_VARIANTS, SYMBOL_RASTER, rasterize, toSymbolTensor } from './raster';
import { segment, type SegmentedRow } from './segment';
import type { InputStroke, RecognitionResult, RowResult, SymbolResult } from './types';

/** The two neural networks, abstracted so the engine runs in the worker, in Node tests and in benchmarks. */
export interface ModelRunner {
  /** `n` symbol tensors packed as [n,3,50,50] → [n,16] class probabilities. */
  symbols(batch: Float32Array, n: number): Promise<Float32Array>;
  /** One 28×28 ink grid → 10 logits. */
  digit(grid: Float32Array): Promise<Float32Array>;
}

interface RawOutputs {
  pSym: Float32Array;
  pDig: Float32Array;
}

const SYMBOL_PIXELS = 3 * 50 * 50;
const MAX_CACHE = 600;

/**
 * Whole-page recognition: strokes → rows → symbols → (rasterise → CNNs → fuse) → text per row.
 *
 * Network outputs are cached per symbol (keyed by its stroke ids; strokes are immutable and every
 * edit creates new ids), so after an edit only the symbols that actually changed are re-inferred and
 * the "fusion with shape priors" step is simply recomputed.
 */
export class RecognitionEngine {
  private cache = new Map<string, RawOutputs>();

  constructor(private readonly runner: ModelRunner) {}

  async recognize(strokes: readonly InputStroke[]): Promise<RecognitionResult> {
    const t0 = performance.now();
    const rows = segment(strokes);

    // 1. Find the symbols that still need inference.
    interface Job {
      key: string;
      group: SegmentedRow['groups'][number];
      typical: number;
    }
    const jobs: Job[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      for (const group of row.groups) {
        const key = keyOf(group.strokes.map((s) => s.stroke.id));
        if (!this.cache.has(key) && !seen.has(key)) {
          seen.add(key);
          jobs.push({ key, group, typical: row.typical });
        }
      }
    }

    // 2. Rasterise + infer: one batched call for symbols16, one tiny call per symbol for MNIST.
    if (jobs.length) {
      const batch = new Float32Array(jobs.length * SYMBOL_PIXELS);
      const grids: Float32Array[][] = [];
      jobs.forEach((job, i) => {
        const strokesOf = job.group.strokes.map((s) => s.stroke);
        const minExtent = job.typical * 0.5;
        batch.set(toSymbolTensor(rasterize(strokesOf, job.group.bbox, { ...SYMBOL_RASTER, minExtent })), i * SYMBOL_PIXELS);
        grids.push(MNIST_VARIANTS.map((v) => rasterize(strokesOf, job.group.bbox, { ...v, minExtent })));
      });
      const probs = await this.runner.symbols(batch, jobs.length);
      for (let i = 0; i < jobs.length; i++) {
        // Test-time augmentation: average the digit net over several renderings of the same ink.
        const pDig = new Float32Array(10);
        for (const grid of grids[i]) {
          const p = softmax(await this.runner.digit(grid));
          for (let k = 0; k < 10; k++) pDig[k] += p[k] / grids[i].length;
        }
        this.remember(jobs[i].key, { pSym: probs.slice(i * 16, i * 16 + 16), pDig });
      }
    }

    // 3. Fuse with shape priors and assemble rows.
    const out: RowResult[] = rows.map((row) => this.buildRow(row));
    return { rows: out, ms: performance.now() - t0, inferred: jobs.length };
  }

  clearCache() {
    this.cache.clear();
  }

  private remember(key: string, value: RawOutputs) {
    if (this.cache.size >= MAX_CACHE) {
      // Drop the oldest entries (Map preserves insertion order) → bounded memory in long sessions.
      for (const k of this.cache.keys()) {
        this.cache.delete(k);
        if (this.cache.size < MAX_CACHE * 0.8) break;
      }
    }
    this.cache.set(key, value);
  }

  private buildRow(row: SegmentedRow): RowResult {
    const symbols: SymbolResult[] = row.groups.map((group) => {
      const raw = this.cache.get(keyOf(group.strokes.map((s) => s.stroke.id)))!;
      const ranked = fuse(raw.pSym, raw.pDig, featuresOf(group, row.typical));
      return {
        strokeIds: group.strokes.map((s) => s.stroke.id),
        bbox: group.bbox,
        label: ranked[0].label,
        confidence: ranked[0].p,
        alternatives: ranked.slice(0, 3),
      };
    });
    const last = symbols[symbols.length - 1];
    return {
      symbols,
      text: symbols.map((s) => s.label).join(''),
      bbox: row.bbox,
      symbolHeight: row.typical,
      equals: last && last.label === '=' ? { bbox: last.bbox } : null,
    };
  }
}

function keyOf(ids: number[]): string {
  return ids.slice().sort((a, b) => a - b).join(',');
}
