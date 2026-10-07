/** Logical (CSS-pixel) rectangle. */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type Tool = 'pen' | 'stroke-eraser' | 'pan';

/**
 * A finished ink stroke. Coordinates are logical CSS pixels relative to the canvas origin
 * (independent of devicePixelRatio and of window size). `pts` is packed [x, y, pressure] triples
 * in a Float32Array: compact in memory and transferable to the recognition worker.
 */
export interface Stroke {
  readonly id: number;
  readonly pts: Float32Array;
  /** Base line width in logical px. */
  readonly width: number;
  /** True for pen input whose pressure should modulate the width. */
  readonly pressure: boolean;
  /** Ink colour key; absent means the default 'ink'. */
  readonly color?: ColorKey;
}

/**
 * Ink colours are stored as semantic keys (not hex), so a note stays readable in light AND dark
 * themes: the app maps each key to a theme-appropriate colour when painting. Recognition never looks
 * at colour - it works from stroke geometry only - so "2" in blue and "+" in black read as "2+".
 */
export const COLOR_KEYS = ['ink', 'blue', 'green', 'red', 'purple'] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export const isColorKey = (v: unknown): v is ColorKey => typeof v === 'string' && (COLOR_KEYS as readonly string[]).includes(v);

export const STRIDE = 3;

export const pointCount = (s: Stroke) => s.pts.length / STRIDE;
