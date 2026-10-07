import { rectHeight, rectWidth, strokeBounds, unionRect } from '../ink/geometry';
import { STRIDE, type Rect } from '../ink/types';
import type { InputStroke } from './types';

export interface StrokeInfo {
  stroke: InputStroke;
  bbox: Rect;
}

/** One handwritten symbol = one or more strokes, with its combined geometry. */
export interface SymbolGroup {
  strokes: StrokeInfo[];
  bbox: Rect;
}

const maxDim = (r: Rect) => Math.max(rectWidth(r), rectHeight(r));

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Typical symbol size: the median extent of the "substantial" strokes (those at least 35 % as big as
 * the biggest one), so tiny dots and long minus bars do not drag the estimate around.
 */
export function typicalSize(boxes: Rect[], floor = 10): number {
  if (boxes.length === 0) return floor;
  const dims = boxes.map(maxDim);
  const biggest = Math.max(...dims);
  const substantial = dims.filter((d) => d >= biggest * 0.35);
  return Math.max(median(substantial), floor);
}

function toInfo(stroke: InputStroke): StrokeInfo | null {
  if (stroke.pts.length < STRIDE) return null;
  return {
    stroke,
    bbox: strokeBounds({ id: stroke.id, pts: stroke.pts, width: 0, pressure: false }),
  };
}

/**
 * Splits the page into text rows. Strokes are scanned top-to-bottom; a stroke joins the current row
 * when its vertical extent (plus a tolerance) touches the row's extent.
 */
export function splitRows(infos: StrokeInfo[], typical: number): StrokeInfo[][] {
  const centre = (i: StrokeInfo) => (i.bbox.minY + i.bbox.maxY) / 2;
  const sorted = infos.slice().sort((a, b) => centre(a) - centre(b));
  const tol = typical * 0.25;
  type Row = { minY: number; maxY: number; items: StrokeInfo[] };
  let rows: Row[] = [];
  for (const info of sorted) {
    const row = rows[rows.length - 1];
    if (row && info.bbox.minY <= row.maxY + tol && info.bbox.maxY >= row.minY - tol) {
      row.items.push(info);
      row.minY = Math.min(row.minY, info.bbox.minY);
      row.maxY = Math.max(row.maxY, info.bbox.maxY);
    } else {
      rows.push({ minY: info.bbox.minY, maxY: info.bbox.maxY, items: [info] });
    }
  }
  // A row's extent keeps growing while strokes join it, so an earlier row can end up overlapping a
  // later one (e.g. the flat top bar of a "7" sorts before the "=" that sits mid-line). Merge those.
  for (let changed = true; changed; ) {
    changed = false;
    rows.sort((a, b) => a.minY - b.minY);
    const merged: Row[] = [];
    for (const r of rows) {
      const prev = merged[merged.length - 1];
      if (prev && r.minY <= prev.maxY + tol) {
        prev.items.push(...r.items);
        prev.maxY = Math.max(prev.maxY, r.maxY);
        changed = true;
      } else {
        merged.push(r);
      }
    }
    rows = merged;
  }
  return rows.map((r) => r.items);
}

/**
 * Groups the strokes of one row into symbols. Two strokes belong to the same symbol when their
 * horizontal extents overlap substantially or one sits inside the other (a "+" cross, the two bars of
 * "=", the dots of "÷", the two strokes of "4" or "×") and they are vertically close.
 */
export function groupRow(items: StrokeInfo[], typical: number): SymbolGroup[] {
  const sorted = items.slice().sort((a, b) => a.bbox.minX - b.bbox.minX);
  const groups: SymbolGroup[] = [];
  const eps = typical * 0.06;
  const floorW = typical * 0.1;

  for (const info of sorted) {
    let best = -1;
    let bestScore = 0;
    groups.forEach((g, gi) => {
      const a = info.bbox;
      const b = g.bbox;
      const overlap = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const narrow = Math.max(Math.min(rectWidth(a), rectWidth(b)), floorW);
      const inside =
        (a.minX >= b.minX - eps && a.maxX <= b.maxX + eps) || (b.minX >= a.minX - eps && b.maxX <= a.maxX + eps);
      const vGap = Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY); // <0 when they overlap vertically
      const closeV = vGap <= typical * 0.9;
      if (!closeV) return;
      const score = inside ? 1 + Math.max(overlap, 0) / narrow : overlap / narrow;
      if ((inside || overlap >= 0.4 * narrow) && score > bestScore) {
        best = gi;
        bestScore = score;
      }
    });
    if (best >= 0) {
      groups[best].strokes.push(info);
      groups[best].bbox = unionRect(groups[best].bbox, info.bbox);
    } else {
      groups.push({ strokes: [info], bbox: { ...info.bbox } });
    }
  }
  return groups.sort((a, b) => a.bbox.minX - b.bbox.minX);
}

export interface SegmentedRow {
  groups: SymbolGroup[];
  bbox: Rect;
  /** Typical symbol extent of this row (logical px). */
  typical: number;
}

/** Full segmentation: strokes → rows (top to bottom) → symbols (left to right). */
export function segment(strokes: readonly InputStroke[]): SegmentedRow[] {
  const infos = strokes.map(toInfo).filter((i): i is StrokeInfo => i !== null);
  if (infos.length === 0) return [];
  const globalTypical = typicalSize(infos.map((i) => i.bbox));
  return splitRows(infos, globalTypical).map((items) => {
    const rowTypical = typicalSize(items.map((i) => i.bbox), Math.min(globalTypical, 10));
    const groups = groupRow(items, rowTypical);
    // Re-estimate from whole symbols (a "+" or "=" is one symbol, not two strokes).
    const typical = typicalSize(groups.map((g) => g.bbox), 10);
    const bbox = groups.reduce((acc, g) => unionRect(acc, g.bbox), groups[0].bbox);
    return { groups, bbox, typical };
  });
}
