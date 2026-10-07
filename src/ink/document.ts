import type { Stroke } from './types';

interface Command {
  /** Strokes taken out by this command, with the index they occupied. */
  removed: Array<{ index: number; stroke: Stroke }>;
  /** Strokes put in by this command (appended). */
  added: Stroke[];
}

export type DocListener = (change: { kind: 'edit' | 'undo' | 'redo' | 'clear' | 'load' }) => void;

/**
 * The stroke model plus undo/redo history.
 *
 * Every mutation is a Command {removed, added}; undo/redo just swap them, so add / stroke-erase /
 * pixel-erase / clear all share one tested code path. Several commands can be grouped
 * (beginGroup/endGroup) so one eraser drag is ONE undo step.
 */
export class InkDocument {
  private _strokes: Stroke[] = [];
  private undoStack: Command[][] = [];
  private redoStack: Command[][] = [];
  private group: Command[] | null = null;
  private listeners = new Set<DocListener>();
  private idCounter = 1;
  /** Increments on every change; handy for cheap "did anything change" checks. */
  version = 0;

  constructor(private readonly maxHistory = 500) {}

  get strokes(): readonly Stroke[] {
    return this._strokes;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get isEmpty() {
    return this._strokes.length === 0;
  }

  newId(): number {
    return this.idCounter++;
  }

  subscribe(fn: DocListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(kind: 'edit' | 'undo' | 'redo' | 'clear' | 'load') {
    this.version++;
    for (const l of this.listeners) l({ kind });
  }

  // ---- mutations -------------------------------------------------------------------------
  add(stroke: Stroke): void {
    this.run({ removed: [], added: [stroke] }, 'edit');
  }

  /** Remove strokes by id (stroke eraser). No-op if none match. */
  remove(ids: Iterable<number>): void {
    const set = new Set(ids);
    const removed: Command['removed'] = [];
    this._strokes.forEach((stroke, index) => {
      if (set.has(stroke.id)) removed.push({ index, stroke });
    });
    if (removed.length) this.run({ removed, added: [] }, 'edit');
  }

  /** Replace some strokes by fragments (pixel eraser). */
  replace(ids: Iterable<number>, fragments: Stroke[]): void {
    const set = new Set(ids);
    const removed: Command['removed'] = [];
    this._strokes.forEach((stroke, index) => {
      if (set.has(stroke.id)) removed.push({ index, stroke });
    });
    if (removed.length || fragments.length) this.run({ removed, added: fragments }, 'edit');
  }

  clear(): void {
    if (this._strokes.length === 0) return;
    const removed = this._strokes.map((stroke, index) => ({ index, stroke }));
    this.run({ removed, added: [] }, 'clear');
  }

  /** Replace the whole content (used when restoring a saved page). Resets history. */
  load(strokes: Stroke[]): void {
    this._strokes = strokes.slice();
    this.undoStack = [];
    this.redoStack = [];
    for (const s of strokes) this.idCounter = Math.max(this.idCounter, s.id + 1);
    this.emit('load');
  }

  beginGroup(): void {
    if (!this.group) this.group = [];
  }

  endGroup(): void {
    const g = this.group;
    this.group = null;
    if (g && g.length) this.pushUndo(g);
  }

  // ---- history ---------------------------------------------------------------------------
  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    for (let i = entry.length - 1; i >= 0; i--) this.revert(entry[i]);
    this.redoStack.push(entry);
    this.emit('undo');
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    for (const cmd of entry) this.apply(cmd);
    this.undoStack.push(entry);
    this.emit('redo');
    return true;
  }

  // ---- internals -------------------------------------------------------------------------
  private run(cmd: Command, kind: 'edit' | 'clear') {
    this.apply(cmd);
    if (this.group) this.group.push(cmd);
    else this.pushUndo([cmd]);
    this.redoStack = [];
    this.emit(kind);
  }

  private pushUndo(entry: Command[]) {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift(); // bounded memory
  }

  private apply(cmd: Command) {
    if (cmd.removed.length) {
      const ids = new Set(cmd.removed.map((r) => r.stroke.id));
      this._strokes = this._strokes.filter((s) => !ids.has(s.id));
    }
    if (cmd.added.length) this._strokes.push(...cmd.added);
  }

  private revert(cmd: Command) {
    if (cmd.added.length) {
      const ids = new Set(cmd.added.map((s) => s.id));
      this._strokes = this._strokes.filter((s) => !ids.has(s.id));
    }
    // Re-insert in ascending original index so earlier indices stay valid.
    for (const { index, stroke } of [...cmd.removed].sort((a, b) => a.index - b.index)) {
      this._strokes.splice(Math.min(index, this._strokes.length), 0, stroke);
    }
  }
}
