import { evaluateEquation, evaluateExpression } from '../math';
import type { Rect } from '../ink/types';
import type { RowResult } from '../recognition/types';

export type EquationKind = 'ok' | 'undefined' | 'error' | 'check-ok' | 'check-wrong';

/** Everything the UI needs to draw/list one recognised equation. */
export interface EquationView {
  /** Stable identity (ids of the '=' strokes) so the UI can animate only when an answer changes. */
  key: string;
  /** Recognised characters, e.g. "18+4×3=". */
  text: string;
  /** What is projected next to the '=' ("30", "Undefined", "Error", "✓", "✗"). */
  display: string;
  kind: EquationKind;
  /**
   * Where to draw the answer (logical px). `side: 'right'` → `anchor.x` is the answer's LEFT edge;
   * `side: 'left'` → `anchor.x` is the answer's RIGHT edge (it sits left of the '=').
   * `anchor.y` is the vertical centre.
   */
  anchor: { x: number; y: number };
  side: 'left' | 'right';
  /** Used when `side` is 'left' but there is no room left of the '=': draw after the row instead. */
  fallback?: { x: number; y: number };
  /** Suggested font size so the answer matches the handwriting height. */
  fontSize: number;
  /** Lowest per-symbol confidence in the row (0..1). */
  minConfidence: number;
  bbox: Rect;
}

export const LOW_CONFIDENCE = 0.6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Turns recognition rows into projected answers.
 *   "18+4×3="       → answer 30 right after the '='
 *   "5÷0="          → "Undefined"
 *   "5+="           → "Error"
 *   "2+2=4"         → a ✓ / ✗ after the user's own answer (auto-check)
 *   "=17×8"         → answer 136 to the LEFT of the leading '=' (reads "136 = 17×8"); if there is no
 *                      room on the left it falls back to the end of the line
 * Rows without any '=' produce nothing (the user is still writing).
 */
export function describeRows(rows: readonly RowResult[]): EquationView[] {
  const out: EquationView[] = [];
  for (const row of rows) {
    const eqIndex = row.text.indexOf('=');
    if (eqIndex < 0 || row.symbols.length < 2) continue;
    const minConfidence = Math.min(...row.symbols.map((s) => s.confidence));
    const fontSize = clamp(row.symbolHeight * 1.35, 24, 140);

    if (row.equals) {
      const eq = row.equals.bbox;
      const res = evaluateEquation(row.text);
      out.push({
        key: row.symbols[row.symbols.length - 1].strokeIds.join(','),
        text: row.text,
        display: res.text,
        kind: res.ok ? 'ok' : res.kind === 'undefined' ? 'undefined' : 'error',
        anchor: { x: eq.maxX + Math.max(10, row.symbolHeight * 0.4), y: (eq.minY + eq.maxY) / 2 },
        side: 'right',
        fontSize,
        minConfidence,
        bbox: row.bbox,
      });
      continue;
    }

    // "= expr": equals sign FIRST, expression after it → evaluate the part to the right.
    if (eqIndex === 0) {
      const rest = row.text.slice(1);
      if (rest.length === 0 || rest.includes('=')) continue;
      const res = evaluateExpression(rest);
      const eq = row.symbols[0].bbox;
      const gap = Math.max(10, row.symbolHeight * 0.4);
      out.push({
        key: 'pre:' + row.symbols[0].strokeIds.join(','),
        text: row.text,
        display: res.text,
        kind: res.ok ? 'ok' : res.kind === 'undefined' ? 'undefined' : 'error',
        // Right edge of the answer sits just left of the leading '='.
        anchor: { x: eq.minX - gap, y: (eq.minY + eq.maxY) / 2 },
        side: 'left',
        fallback: { x: row.bbox.maxX + gap, y: (eq.minY + eq.maxY) / 2 },
        fontSize,
        minConfidence,
        bbox: row.bbox,
      });
      continue;
    }

    // "expr = number": check the user's own answer.
    const lhs = row.text.slice(0, eqIndex);
    const rhs = row.text.slice(eqIndex + 1);
    if (rhs.length > 0 && !rhs.includes('=') && /^\d+(\.\d+)?$/.test(rhs)) {
      const a = evaluateExpression(lhs);
      const b = evaluateExpression(rhs);
      if (a.ok && b.ok) {
        const lastBox = row.symbols[row.symbols.length - 1].bbox;
        const correct = Math.abs(a.value - b.value) <= 1e-9 * Math.max(1, Math.abs(a.value));
        out.push({
          key: 'chk:' + row.symbols[eqIndex].strokeIds.join(','),
          text: row.text,
          display: correct ? '✓' : '✗',
          kind: correct ? 'check-ok' : 'check-wrong',
          anchor: { x: row.bbox.maxX + Math.max(10, row.symbolHeight * 0.4), y: (lastBox.minY + lastBox.maxY) / 2 },
          side: 'right',
          fontSize,
          minConfidence,
          bbox: row.bbox,
        });
      }
    }
  }
  return out;
}
