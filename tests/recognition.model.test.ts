import { describe, expect, it } from 'vitest';
import { realEngine } from './helpers/node-runner';
import { rng, writeText } from './helpers/handwriting';

// Smoke test: can the real engine (segmentation + both ONNX models in the loop) run in Node?
describe('engine smoke', () => {
  it('recognises a simple equation', async () => {
    const engine = await realEngine();
    const w = writeText('18+4×3=', { seed: 7 });
    const res = await engine.recognize(w.strokes);
    console.log(JSON.stringify(res.rows.map((r) => ({ text: r.text, conf: r.symbols.map((s) => s.confidence.toFixed(2)) }))), res.ms.toFixed(0) + 'ms');
    expect(res.rows.length).toBe(1);
  }, 60000);
  it('prng is deterministic', () => {
    expect(rng(3)()).toBe(rng(3)());
  });
});
