import { STRIDE, type Rect, type Stroke } from './types';

export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Client (viewport) coordinates → logical canvas coordinates.
 * Accounts for the element's offset and for any CSS scaling between its layout size and the
 * logical size the document is expressed in.
 */
export function clientToLogical(
  clientX: number,
  clientY: number,
  rect: ClientRectLike,
  logicalWidth: number,
  logicalHeight: number,
): { x: number; y: number } {
  const sx = rect.width > 0 ? logicalWidth / rect.width : 1;
  const sy = rect.height > 0 ? logicalHeight / rect.height : 1;
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
}

/**
 * Backing-store size for a canvas of `cssW × cssH` logical px on a display with `dpr`.
 * Rounds so the canvas covers the whole CSS box, and returns the exact transform scale to use
 * with ctx.setTransform so one logical px == `scaleX` device px.
 */
export function backingStore(cssW: number, cssH: number, dpr: number) {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const width = Math.max(1, Math.round(cssW * d));
  const height = Math.max(1, Math.round(cssH * d));
  return { width, height, scaleX: width / Math.max(cssW, 1e-6), scaleY: height / Math.max(cssH, 1e-6) };
}

export function strokeBounds(s: Stroke): Rect {
  const p = s.pts;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < p.length; i += STRIDE) {
    const x = p[i], y = p[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export const rectWidth = (r: Rect) => r.maxX - r.minX;
export const rectHeight = (r: Rect) => r.maxY - r.minY;

export function unionRect(a: Rect, b: Rect): Rect {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function inflateRect(r: Rect, d: number): Rect {
  return { minX: r.minX - d, minY: r.minY - d, maxX: r.maxX + d, maxY: r.maxY + d };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Distance from point (px,py) to segment (ax,ay)-(bx,by). */
export function distPointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function pathLength(s: Stroke): number {
  const p = s.pts;
  let len = 0;
  for (let i = STRIDE; i < p.length; i += STRIDE) len += Math.hypot(p[i] - p[i - STRIDE], p[i + 1] - p[i + 1 - STRIDE]);
  return len;
}

/**
 * Ramer–Douglas–Peucker simplification of packed [x,y,p] points. Keeps the first/last point.
 * Used on commit to shrink long, over-sampled strokes without visible change (epsilon ≈ 0.2px).
 */
export function simplifyPoints(pts: number[], epsilon: number): number[] {
  const n = pts.length / STRIDE;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0, idx = -1;
    const ax = pts[a * STRIDE], ay = pts[a * STRIDE + 1], bx = pts[b * STRIDE], by = pts[b * STRIDE + 1];
    for (let i = a + 1; i < b; i++) {
      const d = distPointSegment(pts[i * STRIDE], pts[i * STRIDE + 1], ax, ay, bx, by);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * STRIDE], pts[i * STRIDE + 1], pts[i * STRIDE + 2]);
  return out;
}
