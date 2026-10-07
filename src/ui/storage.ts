import { isColorKey, type ColorKey, type Stroke } from '../ink/types';

/** localStorage that never throws (private windows, blocked storage, quota). */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const PAGE_KEY = 'calcink.page.v1';

interface SavedStroke {
  id: number;
  w: number;
  p: 0 | 1;
  /** Colour key; omitted for the default 'ink' (keeps old saves valid and small). */
  c?: ColorKey;
  pts: number[];
}

/** Serialise strokes compactly (coordinates rounded to 0.1 px). */
export function serializeStrokes(strokes: readonly Stroke[]): string {
  const data: SavedStroke[] = strokes.map((s) => {
    const out: SavedStroke = {
      id: s.id,
      w: s.width,
      p: s.pressure ? 1 : 0,
      pts: Array.from(s.pts, (v, i) => (i % 3 === 2 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10)),
    };
    if (s.color && s.color !== 'ink') out.c = s.color;
    return out;
  });
  return JSON.stringify({ v: 1, strokes: data });
}

/** Parse what serializeStrokes wrote. Returns [] for anything malformed. */
export function deserializeStrokes(json: string | null): Stroke[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as { v?: number; strokes?: SavedStroke[] };
    if (parsed.v !== 1 || !Array.isArray(parsed.strokes)) return [];
    return parsed.strokes
      .filter((s) => Array.isArray(s.pts) && s.pts.length >= 3 && s.pts.length % 3 === 0 && s.pts.every((n) => Number.isFinite(n)))
      .map((s) => ({ id: s.id, width: s.w, pressure: s.p === 1, pts: Float32Array.from(s.pts), color: isColorKey(s.c) ? s.c : 'ink' }));
  } catch {
    return [];
  }
}

export const savePage = (strokes: readonly Stroke[]) =>
  strokes.length === 0 ? (safeStorage.remove(PAGE_KEY), true) : safeStorage.set(PAGE_KEY, serializeStrokes(strokes));
export const loadPage = () => deserializeStrokes(safeStorage.get(PAGE_KEY));
