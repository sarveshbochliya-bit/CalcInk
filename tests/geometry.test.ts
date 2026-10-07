import { describe, expect, it } from 'vitest';
import {
  backingStore,
  clientToLogical,
  distPointSegment,
  pathLength,
  rectsIntersect,
  simplifyPoints,
  strokeBounds,
  unionRect,
} from '../src/ink/geometry';
import type { Stroke } from '../src/ink/types';

const mk = (id: number, xy: number[], width = 4): Stroke => {
  const pts = new Float32Array((xy.length / 2) * 3);
  for (let i = 0; i < xy.length / 2; i++) {
    pts[i * 3] = xy[i * 2];
    pts[i * 3 + 1] = xy[i * 2 + 1];
    pts[i * 3 + 2] = 0.5;
  }
  return { id, pts, width, pressure: false };
};

describe('clientToLogical (coordinate conversion)', () => {
  it('subtracts the element offset', () => {
    expect(clientToLogical(150, 80, { left: 100, top: 50, width: 800, height: 600 }, 800, 600)).toEqual({ x: 50, y: 30 });
  });
  it('compensates for CSS scaling (rendered size ≠ logical size)', () => {
    // element is drawn at half size: 1 client px == 2 logical px
    const p = clientToLogical(60, 30, { left: 10, top: 10, width: 400, height: 300 }, 800, 600);
    expect(p).toEqual({ x: 100, y: 40 });
  });
  it('handles negative / outside coordinates without clamping', () => {
    expect(clientToLogical(0, 0, { left: 20, top: 20, width: 100, height: 100 }, 100, 100)).toEqual({ x: -20, y: -20 });
  });
  it('does not divide by zero for a collapsed element', () => {
    const p = clientToLogical(5, 5, { left: 0, top: 0, width: 0, height: 0 }, 100, 100);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

describe('backingStore (devicePixelRatio)', () => {
  it('scales the backing store by dpr', () => {
    expect(backingStore(800, 600, 2)).toMatchObject({ width: 1600, height: 1200, scaleX: 2, scaleY: 2 });
  });
  it('supports fractional dpr (Windows 125% / 150%) and keeps the box covered', () => {
    const b = backingStore(801, 601, 1.5);
    expect(b.width).toBe(Math.round(801 * 1.5));
    expect(b.scaleX * 801).toBeCloseTo(b.width, 6);
  });
  it('falls back to 1 for invalid dpr', () => {
    expect(backingStore(100, 50, 0)).toMatchObject({ width: 100, height: 50 });
    expect(backingStore(100, 50, NaN)).toMatchObject({ width: 100, height: 50 });
  });
  it('never creates a zero-sized canvas', () => {
    expect(backingStore(0, 0, 2).width).toBeGreaterThanOrEqual(1);
  });
});

describe('rect / stroke geometry', () => {
  it('strokeBounds', () => expect(strokeBounds(mk(1, [10, 20, 30, 5, 15, 40]))).toEqual({ minX: 10, minY: 5, maxX: 30, maxY: 40 }));
  it('unionRect', () =>
    expect(unionRect({ minX: 0, minY: 0, maxX: 5, maxY: 5 }, { minX: 3, minY: -2, maxX: 9, maxY: 4 })).toEqual({ minX: 0, minY: -2, maxX: 9, maxY: 5 }));
  it('rectsIntersect', () => {
    expect(rectsIntersect({ minX: 0, minY: 0, maxX: 5, maxY: 5 }, { minX: 5, minY: 5, maxX: 9, maxY: 9 })).toBe(true);
    expect(rectsIntersect({ minX: 0, minY: 0, maxX: 5, maxY: 5 }, { minX: 6, minY: 0, maxX: 9, maxY: 9 })).toBe(false);
  });
  it('distPointSegment', () => {
    expect(distPointSegment(5, 5, 0, 0, 10, 0)).toBe(5);
    expect(distPointSegment(-3, 0, 0, 0, 10, 0)).toBe(3); // clamps to the endpoint
    expect(distPointSegment(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2); // degenerate segment
  });
  it('pathLength', () => expect(pathLength(mk(1, [0, 0, 3, 4, 3, 10]))).toBe(11));
});

describe('simplifyPoints', () => {
  it('drops collinear points but keeps ends and corners', () => {
    const pts = [0, 0, 1, 5, 0, 1, 10, 0, 1, 10, 10, 1];
    const out = simplifyPoints(pts, 0.2);
    expect(out).toEqual([0, 0, 1, 10, 0, 1, 10, 10, 1]);
  });
  it('leaves 2-point strokes alone', () => expect(simplifyPoints([0, 0, 1, 1, 1, 1], 1)).toEqual([0, 0, 1, 1, 1, 1]));
});
