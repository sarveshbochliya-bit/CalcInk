import { distPointSegment, inflateRect, rectsIntersect, strokeBounds } from './geometry';
import { STRIDE, type Stroke } from './types';

/** Does the eraser circle (cx,cy,r) touch this stroke (taking its line width into account)? */
export function strokeHitsCircle(s: Stroke, cx: number, cy: number, r: number): boolean {
  const reach = r + s.width / 2;
  if (!rectsIntersect(inflateRect(strokeBounds(s), 0), { minX: cx - reach, minY: cy - reach, maxX: cx + reach, maxY: cy + reach })) {
    return false;
  }
  const p = s.pts;
  if (p.length === STRIDE) return Math.hypot(p[0] - cx, p[1] - cy) <= reach;
  for (let i = STRIDE; i < p.length; i += STRIDE) {
    if (distPointSegment(cx, cy, p[i - STRIDE], p[i - STRIDE + 1], p[i], p[i + 1]) <= reach) return true;
  }
  return false;
}

/** Stroke eraser: ids of all strokes touched by the circle. */
export function strokesTouching(strokes: readonly Stroke[], cx: number, cy: number, r: number): number[] {
  const ids: number[] = [];
  for (const s of strokes) if (strokeHitsCircle(s, cx, cy, r)) ids.push(s.id);
  return ids;
}

/** Insert points so no segment is longer than maxSeg (needed so a fast stroke can't "tunnel" through the eraser). */
function densify(pts: Float32Array, maxSeg: number): number[] {
  const out: number[] = [pts[0], pts[1], pts[2]];
  for (let i = STRIDE; i < pts.length; i += STRIDE) {
    const x0 = pts[i - STRIDE], y0 = pts[i - STRIDE + 1], p0 = pts[i - STRIDE + 2];
    const x1 = pts[i], y1 = pts[i + 1], p1 = pts[i + 2];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / maxSeg));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p0 + (p1 - p0) * t);
    }
  }
  return out;
}

/**
 * Pixel eraser applied to one stroke: removes the part of the stroke inside the circle and returns
 * the surviving fragments as new strokes (ids from `newId`). Returns null when the stroke is untouched.
 * Fragments shorter than 2 points are dropped.
 */
export function erasePixels(s: Stroke, cx: number, cy: number, r: number, newId: () => number): Stroke[] | null {
  if (!strokeHitsCircle(s, cx, cy, r)) return null;
  const reach = r + s.width / 2;
  const d = densify(s.pts, Math.max(0.75, reach / 2));
  const fragments: Stroke[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 2 * STRIDE) {
      fragments.push({ id: newId(), pts: Float32Array.from(run), width: s.width, pressure: s.pressure, color: s.color });
    }
    run = [];
  };
  for (let i = 0; i < d.length; i += STRIDE) {
    const inside = Math.hypot(d[i] - cx, d[i + 1] - cy) <= reach;
    if (inside) flush();
    else run.push(d[i], d[i + 1], d[i + 2]);
  }
  flush();
  return fragments;
}
