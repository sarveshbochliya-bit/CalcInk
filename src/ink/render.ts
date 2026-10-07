import { STRIDE, type Stroke } from './types';

/** Width for a point: pen pressure (0..1) modulates the base width, mouse/touch stay constant. */
export function widthAt(base: number, pressure: number, usePressure: boolean): number {
  if (!usePressure) return base;
  const p = Math.min(1, Math.max(0, pressure));
  return base * (0.45 + 1.0 * p);
}

/**
 * Draws a smooth curve through packed [x,y,p] points using quadratic Béziers between segment
 * midpoints (the classic "midpoint smoothing" that has no corners and no lag beyond one sample).
 *
 * `from`/`to` are POINT indices. The curve is drawn for the interval of points [from, to); when
 * `final` is true the tail up to the last point is also drawn. Calling this repeatedly with
 * advancing `from` yields exactly the same geometry as one call over the whole stroke, which is
 * what lets the live layer draw incrementally while the committed layer draws a stroke at once.
 *
 * Returns the next index to pass as `from` for the following call.
 */
export function drawSmooth(
  ctx: CanvasRenderingContext2D,
  pts: ArrayLike<number>,
  from: number,
  count: number,
  baseWidth: number,
  usePressure: boolean,
  final: boolean,
): number {
  const n = count;
  if (n === 0) return from;
  const X = (i: number) => pts[i * STRIDE];
  const Y = (i: number) => pts[i * STRIDE + 1];
  const P = (i: number) => pts[i * STRIDE + 2];
  const mx = (i: number) => (X(i) + X(i + 1)) / 2;
  const my = (i: number) => (Y(i) + Y(i + 1)) / 2;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (n === 1) {
    if (final) {
      ctx.beginPath();
      ctx.arc(X(0), Y(0), widthAt(baseWidth, P(0), usePressure) / 2, 0, Math.PI * 2);
      ctx.fill();
      return 1;
    }
    return from;
  }

  let i = Math.max(from, 0);
  // Interior segments need point i+1, so they are available up to i = n-2.
  const lastInterior = n - 2;

  const segment = (k: number) => {
    // k-th smoothed segment: start (k==0 ? P0 : mid(k-1,k)), control P[k], end mid(k,k+1)
    if (k === 0) {
      ctx.moveTo(X(0), Y(0));
      ctx.lineTo(mx(0), my(0));
    } else {
      ctx.moveTo(mx(k - 1), my(k - 1));
      ctx.quadraticCurveTo(X(k), Y(k), mx(k), my(k));
    }
  };

  if (!usePressure) {
    ctx.lineWidth = baseWidth;
    ctx.beginPath();
    for (let k = i; k <= lastInterior; k++) segment(k);
    if (final) {
      ctx.moveTo(mx(n - 2), my(n - 2));
      ctx.lineTo(X(n - 1), Y(n - 1));
    }
    ctx.stroke();
  } else {
    for (let k = i; k <= lastInterior; k++) {
      ctx.lineWidth = widthAt(baseWidth, (P(k) + P(Math.min(k + 1, n - 1))) / 2, true);
      ctx.beginPath();
      segment(k);
      ctx.stroke();
    }
    if (final) {
      ctx.lineWidth = widthAt(baseWidth, P(n - 1), true);
      ctx.beginPath();
      ctx.moveTo(mx(n - 2), my(n - 2));
      ctx.lineTo(X(n - 1), Y(n - 1));
      ctx.stroke();
    }
  }
  return Math.max(i, lastInterior + 1);
}

/** Draws a committed stroke in one go. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  drawSmooth(ctx, s.pts, 0, s.pts.length / STRIDE, s.width, s.pressure, true);
}
