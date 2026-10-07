import { describe, expect, it } from 'vitest';
import { erasePixels } from '../src/ink/eraser';
import { COLOR_KEYS, isColorKey, type Stroke } from '../src/ink/types';
import { deserializeStrokes, serializeStrokes } from '../src/ui/storage';
import { describeRows } from '../src/app/equations';
import { RecognitionEngine, type ModelRunner } from '../src/recognition/engine';

const stroke = (id: number, color?: Stroke['color']): Stroke => ({
  id,
  pts: Float32Array.from([0, 0, 0.5, 40, 0, 0.5, 80, 0, 0.5]),
  width: 4,
  pressure: false,
  color,
});

describe('ink colours', () => {
  it('knows the palette keys', () => {
    expect(COLOR_KEYS).toEqual(['ink', 'blue', 'green', 'red', 'purple']);
    expect(isColorKey('blue')).toBe(true);
    expect(isColorKey('#ff0000')).toBe(false);
    expect(isColorKey(undefined)).toBe(false);
  });

  it('round-trips per-stroke colour through storage; "ink" is omitted to keep saves small', () => {
    const json = serializeStrokes([stroke(1, 'blue'), stroke(2, 'ink'), stroke(3)]);
    expect(json.match(/"c":/g)).toHaveLength(1);
    expect(deserializeStrokes(json).map((s) => s.color)).toEqual(['blue', 'ink', 'ink']);
  });

  it('pages saved before colours existed still load (as ink); junk colours fall back to ink', () => {
    const old = JSON.stringify({ v: 1, strokes: [{ id: 1, w: 4, p: 0, pts: [0, 0, 0.5, 5, 5, 0.5] }] });
    expect(deserializeStrokes(old)[0].color).toBe('ink');
    const junk = JSON.stringify({ v: 1, strokes: [{ id: 1, w: 4, p: 0, c: 'javascript:alert(1)', pts: [0, 0, 0.5, 5, 5, 0.5] }] });
    expect(deserializeStrokes(junk)[0].color).toBe('ink');
  });

  it('the pixel eraser keeps the colour of the fragments it leaves behind', () => {
    const frags = erasePixels(stroke(1, 'green'), 40, 0, 6, (() => { let n = 10; return () => n++; })())!;
    expect(frags.length).toBe(2);
    expect(frags.every((f) => f.color === 'green')).toBe(true);
  });

  it('recognition ignores colour: strokes of different colours read exactly like single-colour ink', async () => {
    // The engine only ever receives {id, pts}; colour is not part of its input type.
    const runner: ModelRunner = {
      symbols: async (_b, n) => new Float32Array(n * 16).fill(1 / 16),
      digit: async () => new Float32Array(10),
    };
    const engine = new RecognitionEngine(runner);
    const mono = [stroke(1), stroke(2)].map((s) => ({ id: s.id, pts: s.pts }));
    const multi = [stroke(1, 'blue'), stroke(2, 'red')].map((s) => ({ id: s.id, pts: s.pts }));
    const a = await engine.recognize(mono);
    engine.clearCache();
    const b = await engine.recognize(multi);
    expect(b.rows.map((r) => r.text)).toEqual(a.rows.map((r) => r.text));
    expect(describeRows(b.rows)).toHaveLength(describeRows(a.rows).length);
  });
});
