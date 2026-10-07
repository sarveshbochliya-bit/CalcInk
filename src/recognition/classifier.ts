import { rectHeight, rectWidth } from '../ink/geometry';
import type { SymbolGroup } from './segment';
import { LABELS, SYMBOL_MODEL_CLASSES, type Candidate, type Label } from './types';

export interface SymbolFeatures {
  nStrokes: number;
  w: number;
  h: number;
  /** Longest side relative to the typical symbol size of its row. */
  relSize: number;
  /** width / height of the whole symbol (large = flat bar). */
  aspect: number;
  /** Number of strokes that are individually flat bars. */
  flatStrokes: number;
}

const isFlat = (w: number, h: number) => w >= 2.2 * Math.max(h, 1e-3);

export function featuresOf(group: SymbolGroup, typical: number): SymbolFeatures {
  const w = rectWidth(group.bbox), h = rectHeight(group.bbox);
  let flat = 0;
  for (const s of group.strokes) if (isFlat(rectWidth(s.bbox), rectHeight(s.bbox))) flat++;
  return {
    nStrokes: group.strokes.length,
    w,
    h,
    relSize: Math.max(w, h) / Math.max(typical, 1e-3),
    aspect: w / Math.max(h, 1e-3),
    flatStrokes: flat,
  };
}

export function softmax(logits: ArrayLike<number>): Float32Array {
  const out = new Float32Array(logits.length);
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    out[i] = Math.exp(logits[i] - max);
    sum += out[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
}

/** A symbol this small (relative to its row) with a single stroke is a decimal point, not a digit. */
export const TINY_REL = 0.28;

/**
 * Prior over the 16 labels given the *shape* of the ink (stroke count, flatness, size). It encodes
 * facts that hold for any handwriting: '-' is a single flat stroke, '=' is two flat strokes, '÷' has a
 * bar plus dots (≥ 2 strokes), '.' is a tiny blob, a flat or tiny blob is never a digit, etc.
 * The values are soft multipliers (never hard zero) so a strong neural vote can still win.
 */
export function shapePrior(f: SymbolFeatures): Record<Label, number> {
  const digit = { v: 1 };
  const g: Record<string, number> = { '+': 1, '-': 1, '×': 1, '÷': 1, '.': 1, '=': 1 };

  const tiny = f.nStrokes === 1 && f.relSize < TINY_REL;
  const flat1 = f.nStrokes === 1 && f.aspect >= 3 && !tiny;

  if (tiny) {
    digit.v = 0.02;
    g['+'] = g['-'] = g['×'] = g['÷'] = g['='] = 0.03;
  } else {
    g['.'] = 0.02;
    if (f.nStrokes === 1) {
      if (flat1) {
        digit.v = 0.03;
        g['+'] = g['×'] = g['÷'] = g['='] = 0.1;
      } else {
        g['-'] = f.aspect >= 2 ? 0.6 : 0.04;
        g['='] = 0.03;
        g['÷'] = 0.12;
        g['+'] = 0.35;
        g['×'] = 0.35;
      }
    } else if (f.nStrokes === 2) {
      g['-'] = 0.05;
      g['='] = f.flatStrokes === 2 ? 1 : 0.12;
      g['÷'] = 0.5;
      if (f.flatStrokes === 2) digit.v = 0.1;
    } else {
      g['-'] = 0.03;
      g['='] = f.flatStrokes >= 2 ? 0.6 : 0.05;
      g['÷'] = 1;
      g['+'] = g['×'] = 0.4;
      digit.v = 0.6;
    }
  }
  const out = {} as Record<Label, number>;
  for (const l of LABELS) out[l] = l >= '0' && l <= '9' ? digit.v : g[l];
  return out;
}

/**
 * Fuses the two networks and the shape prior into one distribution over the 16 labels.
 *
 *  - operators / '.'  : probability from the symbols16 CNN (it is the only model that knows them)
 *  - digits           : the symbols16 CNN says *how likely a digit is at all*; WHICH digit is decided by
 *                       the specialist MNIST CNN (99.4 % on MNIST), blended with the symbols16 digit
 *                       distribution so a confused specialist can be out-voted.
 */
export function fuse(pSymbols: ArrayLike<number>, pDigits: ArrayLike<number> | null, f: SymbolFeatures): Candidate[] {
  const prior = shapePrior(f);
  const raw: Record<Label, number> = {} as Record<Label, number>;

  let digitMass = 0;
  for (let k = 0; k < 10; k++) digitMass += pSymbols[k];
  const symDigit = (k: number) => (digitMass > 1e-9 ? pSymbols[k] / digitMass : 0.1);

  for (let k = 0; k < SYMBOL_MODEL_CLASSES.length; k++) {
    const label = SYMBOL_MODEL_CLASSES[k];
    if (k < 10) {
      const within = pDigits ? 0.8 * pDigits[k] + 0.2 * symDigit(k) : symDigit(k);
      raw[label] = digitMass * within * prior[label];
    } else {
      raw[label] = pSymbols[k] * prior[label];
    }
  }
  // Tiny single stroke → decimal point even when the dataset's 'dec' class looks different.
  if (f.nStrokes === 1 && f.relSize < TINY_REL) raw['.'] = Math.max(raw['.'], 0.6);

  let total = 0;
  for (const l of LABELS) total += raw[l];
  if (total <= 0) total = 1;
  return LABELS.map((label) => ({ label, p: raw[label] / total })).sort((a, b) => b.p - a.p);
}
