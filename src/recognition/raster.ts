import { distPointSegment, rectHeight, rectWidth } from '../ink/geometry';
import { STRIDE, type Rect } from '../ink/types';
import type { InputStroke } from './types';

export interface RasterOptions {
  /** Output is size × size. */
  size: number;
  /** The symbol's longest side, INCLUDING the pen thickness, is scaled to this many pixels (aspect kept). */
  box: number;
  /** Pen thickness in output pixels. */
  thickness: number;
  /** Re-centre the ink by its centre of mass (MNIST convention) instead of by its bounding box. */
  centerOfMass: boolean;
  /** Lower bound for the extent used for scaling, so a tiny dot is not blown up to fill the frame. */
  minExtent: number;
}

/**
 * MNIST convention: 28×28, digit (ink included) in roughly a 17–19 px box, centred by centre of mass,
 * ink = 1 on 0. The digit net is sensitive to stroke width, so the engine classifies several
 * renderings (test-time augmentation) and averages them: 3 pen thicknesses × 3 box sizes. On simulated
 * handwriting this plateau is ~98 % per digit, versus 70–98 % for any single hand-picked setting.
 */
export const MNIST_VARIANTS: ReadonlyArray<Omit<RasterOptions, 'minExtent'>> = [2.8, 3.2, 3.6].flatMap((thickness) =>
  [17, 18, 19].map((box) => ({ size: 28, box, thickness, centerOfMass: true })),
);

/** symbols16 model: 50×50, symbol (ink included) in a 36 px box, ink = 1 on 0. */
export const SYMBOL_RASTER: Omit<RasterOptions, 'minExtent'> = { size: 50, box: 36, thickness: 2.6, centerOfMass: false };

/** Anti-aliased polyline rendering into a size×size float grid (0 = background, 1 = full ink). */
function draw(
  strokes: readonly InputStroke[],
  scale: number,
  tx: number,
  ty: number,
  size: number,
  thickness: number,
  out: Float32Array,
) {
  const half = thickness / 2;
  const seg = (x0: number, y0: number, x1: number, y1: number) => {
    const lo = (v: number) => Math.max(0, Math.floor(v - half - 1));
    const hi = (v: number) => Math.min(size - 1, Math.ceil(v + half + 1));
    const xa = lo(Math.min(x0, x1)), xb = hi(Math.max(x0, x1));
    const ya = lo(Math.min(y0, y1)), yb = hi(Math.max(y0, y1));
    for (let py = ya; py <= yb; py++) {
      for (let px = xa; px <= xb; px++) {
        const d = distPointSegment(px + 0.5, py + 0.5, x0, y0, x1, y1);
        const cov = half + 0.5 - d;
        if (cov > 0) {
          const v = cov > 1 ? 1 : cov;
          const i = py * size + px;
          if (v > out[i]) out[i] = v;
        }
      }
    }
  };
  for (const s of strokes) {
    const p = s.pts;
    const n = p.length / STRIDE;
    if (n === 0) continue;
    let px = p[0] * scale + tx, py = p[1] * scale + ty;
    if (n === 1) seg(px, py, px, py);
    for (let i = 1; i < n; i++) {
      const x = p[i * STRIDE] * scale + tx, y = p[i * STRIDE + 1] * scale + ty;
      seg(px, py, x, y);
      px = x;
      py = y;
    }
  }
}

/** Rasterise the strokes of one symbol into a model-ready ink grid (ink = 1, background = 0). */
export function rasterize(strokes: readonly InputStroke[], bbox: Rect, opt: RasterOptions): Float32Array {
  const { size, box, thickness } = opt;
  const w = rectWidth(bbox), h = rectHeight(bbox);
  const extent = Math.max(w, h, opt.minExtent, 1e-3);
  const scale = Math.max(box - thickness, 1) / extent;
  // Translate so the bounding box is centred in the frame.
  let tx = (size - w * scale) / 2 - bbox.minX * scale;
  let ty = (size - h * scale) / 2 - bbox.minY * scale;
  const out = new Float32Array(size * size);
  draw(strokes, scale, tx, ty, size, thickness, out);

  if (opt.centerOfMass) {
    let m = 0, cx = 0, cy = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = out[y * size + x];
        m += v;
        cx += v * (x + 0.5);
        cy += v * (y + 0.5);
      }
    }
    if (m > 0) {
      tx += size / 2 - cx / m;
      ty += size / 2 - cy / m;
      out.fill(0);
      draw(strokes, scale, tx, ty, size, thickness, out);
    }
  }
  return out;
}

/** symbols16 input: NCHW [1,3,50,50], black ink = 0 on white = 1, grey replicated into 3 channels. */
export function toSymbolTensor(ink: Float32Array): Float32Array {
  const n = ink.length;
  const t = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const v = 1 - ink[i];
    t[i] = v;
    t[n + i] = v;
    t[2 * n + i] = v;
  }
  return t;
}
