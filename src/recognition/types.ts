import type { Rect } from '../ink/types';

/** A stroke as sent to the recognition worker: packed [x, y, pressure] triples (logical px). */
export interface InputStroke {
  id: number;
  pts: Float32Array;
}

/** The recognition vocabulary required by the problem statement. */
export type Label = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '+' | '-' | '×' | '÷' | '.' | '=';

export const LABELS: readonly Label[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '-', '×', '÷', '.', '='];

/** Output order of the symbols16 model: 0-9, add, dec, div, eq, mul, sub. */
export const SYMBOL_MODEL_CLASSES: readonly Label[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '.', '÷', '=', '×', '-'];

export interface Candidate {
  label: Label;
  p: number;
}

export interface SymbolResult {
  strokeIds: number[];
  bbox: Rect;
  label: Label;
  /** Probability of the winning label after fusion + normalisation (0..1). */
  confidence: number;
  /** Top alternatives (including the winner), best first. */
  alternatives: Candidate[];
}

export interface RowResult {
  symbols: SymbolResult[];
  /** The recognised characters joined, e.g. "18+4×3=". */
  text: string;
  bbox: Rect;
  /** Typical symbol height in this row (logical px); used to size the projected answer. */
  symbolHeight: number;
  /** Set when the row ends with '=': where to project the answer. */
  equals: { bbox: Rect } | null;
}

export interface RecognitionResult {
  rows: RowResult[];
  /** Wall-clock time spent in the worker, ms. */
  ms: number;
  /** How many symbols were classified by the neural nets (vs. served from the cache). */
  inferred: number;
}
