import { rectHeight, rectWidth, strokeBounds } from './geometry';
import { STRIDE, type Stroke } from './types';

/**
 * Scratch-to-erase: a quick zig-zag scribble drawn over existing ink deletes that ink.
 *
 * A stroke counts as a scribble when it (a) reverses direction several times, (b) is long compared
 * with its own bounding box (it goes back and forth over the same area) and (c) is not a tiny mark.
 * The thresholds are deliberately conservative so that digits like 2, 5, 8 or 3 — which have at most
 * a couple of sharp turns — are never mistaken for one.
 */
export interface ScribbleOptions {
  /** Minimum number of sharp reversals (> ~100°). */
  minReversals: number;
  /** Minimum ratio  path length / bounding-box diagonal. */
  minLengthRatio: number;
  /** Minimum bounding-box diagonal in logical px. */
  minDiagonal: number;
}

export const DEFAULT_SCRIBBLE: ScribbleOptions = { minReversals: 5, minLengthRatio: 3.2, minDiagonal: 28 };

/** Resample a stroke at ~`step` px spacing (drops jitter so reversals are counted on real direction changes). */
function resample(pts: Float32Array, step: number): Array<[number, number]> {
  const out: Array<[number, number]> = [[pts[0], pts[1]]];
  let last = out[0];
  for (let i = STRIDE; i < pts.length; i += STRIDE) {
    const x = pts[i], y = pts[i + 1];
    if (Math.hypot(x - last[0], y - last[1]) >= step) {
      last = [x, y];
      out.push(last);
    }
  }
  return out;
}

export function countReversals(pts: Float32Array, step = 7): number {
  if (pts.length < 3 * STRIDE) return 0;
  const p = resample(pts, step);
  let count = 0;
  for (let i = 2; i < p.length; i++) {
    const ax = p[i - 1][0] - p[i - 2][0], ay = p[i - 1][1] - p[i - 2][1];
    const bx = p[i][0] - p[i - 1][0], by = p[i][1] - p[i - 1][1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la === 0 || lb === 0) continue;
    const cos = (ax * bx + ay * by) / (la * lb);
    if (cos < -0.17) count++; // turn sharper than ~100°
  }
  return count;
}

export function isScribble(s: Stroke, opt: ScribbleOptions = DEFAULT_SCRIBBLE): boolean {
  const b = strokeBounds(s);
  const diag = Math.hypot(rectWidth(b), rectHeight(b));
  if (diag < opt.minDiagonal) return false;
  let len = 0;
  for (let i = STRIDE; i < s.pts.length; i += STRIDE) len += Math.hypot(s.pts[i] - s.pts[i - STRIDE], s.pts[i + 1] - s.pts[i + 1 - STRIDE]);
  if (len / diag < opt.minLengthRatio) return false;
  return countReversals(s.pts) >= opt.minReversals;
}

/**
 * Ids of the existing strokes that a scribble covers: at least 60 % of a stroke's points must lie
 * inside the scribble's (slightly inflated) bounding box, and the stroke must not be the scribble itself.
 */
export function strokesCoveredBy(scribble: Stroke, others: readonly Stroke[]): number[] {
  const b = strokeBounds(scribble);
  const pad = Math.max(6, scribble.width * 1.5);
  const minX = b.minX - pad, maxX = b.maxX + pad, minY = b.minY - pad, maxY = b.maxY + pad;
  const ids: number[] = [];
  for (const s of others) {
    if (s.id === scribble.id) continue;
    const n = s.pts.length / STRIDE;
    let inside = 0;
    for (let i = 0; i < s.pts.length; i += STRIDE) {
      const x = s.pts[i], y = s.pts[i + 1];
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) inside++;
    }
    if (n > 0 && inside / n >= 0.6) ids.push(s.id);
  }
  return ids;
}
