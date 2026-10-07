/**
 * Handwriting simulator for tests and benchmarks.
 *
 * Digits come from the Hershey "futural" single-stroke font (hersheytext, MIT). Operators are drawn as
 * the strokes people actually use. Every glyph then gets a random rotation, slant, scale, per-point
 * wobble and re-sampling at pen-like density, so the recogniser sees varied, imperfect ink.
 */
import { renderTextArray } from 'hersheytext';
import type { InputStroke } from '../../src/recognition/types';

/** Small seeded PRNG (mulberry32) so tests are deterministic. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = [number, number];
type Glyph = { strokes: Pt[][]; w: number; h: number; yOff: number };

function parsePath(d: string): Pt[][] {
  const out: Pt[][] = [];
  for (const part of d.split('M').filter(Boolean)) {
    const nums = part.replace(/L/g, ' ').trim().split(/[\s,]+/).map(Number);
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    if (pts.length) out.push(pts);
  }
  return out;
}

const digitGlyph = (ch: string): Glyph => {
  const g = renderTextArray(ch, { font: 'futural' })[0];
  const strokes = parsePath(g.d);
  // normalise to a 0..21 high box
  const ys = strokes.flat().map((p) => p[1]);
  const xs = strokes.flat().map((p) => p[0]);
  const minY = Math.min(...ys), maxY = Math.max(...ys), minX = Math.min(...xs), maxX = Math.max(...xs);
  return {
    strokes: strokes.map((s) => s.map(([x, y]) => [x - minX, y - minY] as Pt)),
    w: maxX - minX,
    h: maxY - minY,
    yOff: 0,
  };
};

const OPS: Record<string, Glyph> = {
  '+': { strokes: [[[8, 0], [8, 16]], [[0, 8], [16, 8]]], w: 16, h: 16, yOff: 3 },
  '-': { strokes: [[[0, 0], [15, 0]]], w: 15, h: 0, yOff: 10 },
  '×': { strokes: [[[0, 0], [14, 14]], [[14, 0], [0, 14]]], w: 14, h: 14, yOff: 4 },
  '÷': { strokes: [[[0, 8], [16, 8]], [[8, 1], [8.5, 1.5]], [[8, 15], [8.5, 15.5]]], w: 16, h: 16, yOff: 3 },
  '=': { strokes: [[[0, 0], [15, 0]], [[0, 9], [15, 9]]], w: 15, h: 9, yOff: 6 },
  '.': { strokes: [[[0, 0], [0.7, 0.7]]], w: 1, h: 1, yOff: 20 },
};

export interface WriteOptions {
  /** Digit height in px. */
  height?: number;
  seed?: number;
  /** Top-left of the line. */
  x?: number;
  y?: number;
  /** Random distortion strength (1 = typical handwriting wobble). */
  messiness?: number;
  startId?: number;
  /** Horizontal gap between symbols as a fraction of height. */
  gap?: number;
}

export interface Written {
  strokes: InputStroke[];
  /** One entry per character: the ids of the strokes that make it up. */
  idsPerChar: number[][];
  nextId: number;
  right: number;
}

function resample(pts: Pt[], step: number, rand: () => number, wobble: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([x0 + (x1 - x0) * t + (rand() - 0.5) * wobble, y0 + (y1 - y0) * t + (rand() - 0.5) * wobble]);
    }
  }
  const last = pts[pts.length - 1];
  out.push([last[0] + (rand() - 0.5) * wobble, last[1] + (rand() - 0.5) * wobble]);
  return out;
}

export function writeText(text: string, opt: WriteOptions = {}): Written {
  const H = opt.height ?? 70;
  const rand = rng(opt.seed ?? 1);
  const mess = opt.messiness ?? 1;
  let id = opt.startId ?? 1;
  let x = opt.x ?? 40;
  const y0 = opt.y ?? 40;
  const strokes: InputStroke[] = [];
  const idsPerChar: number[][] = [];

  for (const ch of text) {
    const glyph = OPS[ch] ?? digitGlyph(ch);
    const s = (H / 21) * (1 + (rand() - 0.5) * 0.25 * mess);
    const rot = (rand() - 0.5) * 0.28 * mess; // ±8°
    const shear = (rand() - 0.5) * 0.4 * mess;
    const cx = glyph.w / 2, cy = glyph.h / 2;
    const ids: number[] = [];
    const order = glyph.strokes.map((_, i) => i);
    if (ch === '+' && rand() < 0.5) order.reverse();
    for (const si of order) {
      let pts = glyph.strokes[si];
      // Real strokes are never ruler-straight: add a gentle bow to long segments.
      pts = pts.length === 2 ? [pts[0], [(pts[0][0] + pts[1][0]) / 2 + (rand() - 0.5) * 1.2 * mess, (pts[0][1] + pts[1][1]) / 2 + (rand() - 0.5) * 1.2 * mess], pts[1]] : pts;
      const dense = resample(pts, 0.7, rand, 0.25 * mess);
      const f32 = new Float32Array(dense.length * 3);
      dense.forEach(([px, py], i) => {
        let dx = px - cx, dy = py - cy;
        dx += shear * dy;
        const rx = dx * Math.cos(rot) - dy * Math.sin(rot);
        const ry = dx * Math.sin(rot) + dy * Math.cos(rot);
        f32[i * 3] = x + (rx + cx) * s;
        f32[i * 3 + 1] = y0 + (ry + cy + glyph.yOff) * s;
        f32[i * 3 + 2] = 0.5;
      });
      strokes.push({ id, pts: f32 });
      ids.push(id++);
    }
    idsPerChar.push(ids);
    x += (glyph.w * s) + H * (opt.gap ?? 0.32) * (0.8 + rand() * 0.5);
  }
  return { strokes, idsPerChar, nextId: id, right: x };
}
