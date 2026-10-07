import { describe, expect, it } from 'vitest';
import { realEngine } from './helpers/node-runner';
import { rng, writeText } from './helpers/handwriting';

const DIGITS = '0123456789';
const OPS = ['+', '-', '×', '÷'];

function randomEquation(r: () => number): string {
  const num = () => {
    const len = 1 + Math.floor(r() * 3);
    let s = '';
    for (let i = 0; i < len; i++) s += DIGITS[Math.floor(r() * 10)];
    if (r() < 0.2) s += '.' + DIGITS[Math.floor(r() * 10)];
    return s;
  };
  let s = num();
  const terms = 1 + Math.floor(r() * 3);
  for (let i = 0; i < terms; i++) s += OPS[Math.floor(r() * 4)] + num();
  return s + '=';
}

async function run(count: number, messiness: number, seedBase: number) {
  const engine = await realEngine();
  const r = rng(seedBase);
  let strings = 0, stringsOk = 0, chars = 0, charsOk = 0, segFail = 0;
  const confusions = new Map<string, number>();
  const failures: string[] = [];
  for (let i = 0; i < count; i++) {
    const truth = randomEquation(r);
    const w = writeText(truth, { seed: seedBase * 1000 + i, messiness, height: 60 + Math.floor(r() * 40) });
    engine.clearCache();
    const res = await engine.recognize(w.strokes);
    const got = res.rows.length === 1 ? res.rows[0].text : `<${res.rows.length} rows>`;
    strings++;
    chars += truth.length;
    if (got === truth) {
      stringsOk++;
      charsOk += truth.length;
    } else {
      if (got.length !== truth.length) segFail++;
      else for (let k = 0; k < truth.length; k++) {
        if (got[k] === truth[k]) charsOk++;
        else confusions.set(`${truth[k]}→${got[k]}`, (confusions.get(`${truth[k]}→${got[k]}`) ?? 0) + 1);
      }
      if (failures.length < 12) failures.push(`${truth}  got ${got}`);
    }
  }
  return { strings, stringsOk, chars, charsOk, segFail, confusions: [...confusions.entries()].sort((a, b) => b[1] - a[1]), failures };
}

describe('recognition accuracy on simulated handwriting (real ONNX models)', () => {
  for (const [mess, min] of [[0.6, 0.97], [1.0, 0.88]] as const) {
    it(`messiness ${mess}`, async () => {
      const t = await run(150, mess, 42);
      console.log(`messiness=${mess}: equations ${t.stringsOk}/${t.strings} (${((100 * t.stringsOk) / t.strings).toFixed(1)}%), chars ${((100 * t.charsOk) / t.chars).toFixed(1)}%, segmentation fails ${t.segFail}`);
      console.log('  top confusions:', t.confusions.slice(0, 14).map(([k, v]) => `${k}:${v}`).join('  '));
      console.log('  sample failures:\n   ' + t.failures.join('\n   '));
      expect(t.stringsOk / t.strings).toBeGreaterThanOrEqual(min);
    }, 300000);
  }
});
