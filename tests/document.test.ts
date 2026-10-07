import { describe, expect, it } from 'vitest';
import { InkDocument } from '../src/ink/document';
import { erasePixels, strokeHitsCircle, strokesTouching } from '../src/ink/eraser';
import type { Stroke } from '../src/ink/types';

const line = (id: number, x0: number, y0: number, x1: number, y1: number, width = 4): Stroke => ({
  id,
  pts: Float32Array.from([x0, y0, 0.5, x1, y1, 0.5]),
  width,
  pressure: false,
});

describe('InkDocument history', () => {
  it('add → undo → redo', () => {
    const d = new InkDocument();
    d.add(line(d.newId(), 0, 0, 10, 10));
    d.add(line(d.newId(), 0, 5, 10, 5));
    expect(d.strokes).toHaveLength(2);
    expect(d.undo()).toBe(true);
    expect(d.strokes).toHaveLength(1);
    expect(d.canRedo).toBe(true);
    expect(d.redo()).toBe(true);
    expect(d.strokes).toHaveLength(2);
    expect(d.canRedo).toBe(false);
  });

  it('a new edit clears the redo stack', () => {
    const d = new InkDocument();
    d.add(line(d.newId(), 0, 0, 1, 1));
    d.undo();
    d.add(line(d.newId(), 2, 2, 3, 3));
    expect(d.canRedo).toBe(false);
  });

  it('undo/redo on empty history are safe no-ops', () => {
    const d = new InkDocument();
    expect(d.undo()).toBe(false);
    expect(d.redo()).toBe(false);
  });

  it('stroke erase is undoable and restores the original z-order', () => {
    const d = new InkDocument();
    const [a, b, c] = [d.newId(), d.newId(), d.newId()];
    d.add(line(a, 0, 0, 1, 1));
    d.add(line(b, 0, 2, 1, 2));
    d.add(line(c, 0, 4, 1, 4));
    d.remove([b]);
    expect(d.strokes.map((s) => s.id)).toEqual([a, c]);
    d.undo();
    expect(d.strokes.map((s) => s.id)).toEqual([a, b, c]);
    d.redo();
    expect(d.strokes.map((s) => s.id)).toEqual([a, c]);
  });

  it('clear is undoable', () => {
    const d = new InkDocument();
    d.add(line(d.newId(), 0, 0, 1, 1));
    d.add(line(d.newId(), 0, 2, 1, 2));
    d.clear();
    expect(d.isEmpty).toBe(true);
    d.undo();
    expect(d.strokes).toHaveLength(2);
    d.redo();
    expect(d.isEmpty).toBe(true);
  });

  it('a grouped eraser drag is a single undo step', () => {
    const d = new InkDocument();
    const ids = [d.newId(), d.newId(), d.newId()];
    ids.forEach((id, i) => d.add(line(id, 0, i * 10, 50, i * 10)));
    d.beginGroup();
    d.remove([ids[0]]);
    d.remove([ids[1]]);
    d.endGroup();
    expect(d.strokes).toHaveLength(1);
    d.undo();
    expect(d.strokes).toHaveLength(3);
    d.redo();
    expect(d.strokes).toHaveLength(1);
  });

  it('history is bounded (no unbounded memory growth)', () => {
    const d = new InkDocument(10);
    for (let i = 0; i < 50; i++) d.add(line(d.newId(), 0, i, 1, i));
    let undone = 0;
    while (d.undo()) undone++;
    expect(undone).toBe(10);
  });

  it('notifies subscribers and bumps version', () => {
    const d = new InkDocument();
    const kinds: string[] = [];
    const off = d.subscribe((c) => kinds.push(c.kind));
    d.add(line(d.newId(), 0, 0, 1, 1));
    d.undo();
    d.redo();
    d.clear();
    off();
    d.undo();
    expect(kinds).toEqual(['edit', 'undo', 'redo', 'clear']);
    expect(d.version).toBeGreaterThanOrEqual(5);
  });
});

describe('eraser', () => {
  it('stroke eraser hits strokes within radius (incl. half line width)', () => {
    const s = line(1, 0, 0, 100, 0, 10);
    expect(strokeHitsCircle(s, 50, 12, 8)).toBe(true); // 12 <= 8 + 5
    expect(strokeHitsCircle(s, 50, 20, 8)).toBe(false);
    expect(strokesTouching([s, line(2, 0, 100, 100, 100)], 50, 2, 3)).toEqual([1]);
  });

  it('pixel eraser splits a stroke into two fragments around the cut', () => {
    let id = 100;
    const s = line(1, 0, 0, 100, 0, 2);
    const frags = erasePixels(s, 50, 0, 6, () => id++)!;
    expect(frags).toHaveLength(2);
    const maxX0 = Math.max(...Array.from(frags[0].pts).filter((_, i) => i % 3 === 0));
    const minX1 = Math.min(...Array.from(frags[1].pts).filter((_, i) => i % 3 === 0));
    expect(maxX0).toBeLessThan(50);
    expect(minX1).toBeGreaterThan(50);
    expect(maxX0).toBeGreaterThan(30); // only the circle area is removed, not the whole stroke
  });

  it('pixel eraser on an untouched stroke returns null', () => {
    expect(erasePixels(line(1, 0, 0, 10, 0), 500, 500, 5, () => 9)).toBeNull();
  });

  it('pixel eraser removes a short stroke completely', () => {
    expect(erasePixels(line(1, 49, 0, 51, 0), 50, 0, 10, () => 9)).toEqual([]);
  });

  it('a fast long segment cannot tunnel through the eraser', () => {
    const frags = erasePixels(line(1, 0, 0, 1000, 0, 2), 500, 0, 4, () => 7)!;
    expect(frags).toHaveLength(2);
  });

  it('replace() makes pixel erasing undoable', () => {
    const d = new InkDocument();
    const s = line(d.newId(), 0, 0, 100, 0, 2);
    d.add(s);
    const frags = erasePixels(s, 50, 0, 6, () => d.newId())!;
    d.replace([s.id], frags);
    expect(d.strokes).toHaveLength(2);
    d.undo();
    expect(d.strokes).toHaveLength(1);
    expect(d.strokes[0].id).toBe(s.id);
  });
});
