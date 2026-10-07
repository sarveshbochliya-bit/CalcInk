import { InkDocument } from './document';
import { erasePixels, strokesTouching } from './eraser';
import { backingStore, clientToLogical, simplifyPoints } from './geometry';
import { drawSmooth, drawStroke } from './render';
import { STRIDE, type ColorKey, type Stroke, type Tool } from './types';

/** Theme-resolved CSS colour for each ink colour key. */
export type Palette = Record<ColorKey, string>;
const DEFAULT_PALETTE: Palette = { ink: '#14213d', blue: '#1d4ed8', green: '#15803d', red: '#dc2626', purple: '#7e22ce' };

export interface InkCanvasEvents {
  /** A pointer went down (before anything is committed). */
  onStrokeStart?: () => void;
  /** A stroke/erase gesture finished and the document may have changed. */
  onStrokeEnd?: () => void;
  /** Canvas was resized or the display's pixel ratio changed (layers must repaint). */
  onResize?: (cssW: number, cssH: number, dpr: number) => void;
  /** Called with a finished pen stroke before it is committed; return true to consume it (not added). */
  interceptStroke?: (stroke: Stroke) => boolean;
}

/**
 * The digital-ink surface.
 *
 *   container
 *   ├─ base canvas     committed strokes (repainted only on undo/redo/erase/resize)
 *   ├─ [results canvas inserted by the app between base and live]
 *   ├─ live canvas     the in-progress stroke, drawn incrementally once per animation frame
 *   └─ cursor ring     eraser size indicator (DOM element, moved with transform)
 *
 * Pointer events do the bare minimum (store points, mark dirty); all painting happens in a single
 * requestAnimationFrame callback, and recognition is never triggered from here.
 */
export class InkCanvas {
  readonly base: HTMLCanvasElement;
  readonly live: HTMLCanvasElement;
  tool: Tool = 'pen';
  strokeWidth = 4;
  /** Colour key used for NEW strokes (existing strokes keep the colour they were drawn in). */
  penColor: ColorKey = 'ink';
  private palette: Palette = { ...DEFAULT_PALETTE };

  private baseCtx: CanvasRenderingContext2D;
  private liveCtx: CanvasRenderingContext2D;
  private cursor: HTMLDivElement;
  private ro: ResizeObserver;
  private dprMql: MediaQueryList | null = null;
  private cssW = 0;
  private cssH = 0;
  dpr = 1;
  private rect: DOMRect;

  // active gesture
  private activeId: number | null = null;
  private activeTool: Tool = 'pen';
  private activeType = 'mouse';
  private livePts: number[] = [];
  private liveDrawn = 0;
  private usePressure = false;
  private lastPenTime = -1e9;
  private lastErase: { x: number; y: number } | null = null;
  
  // pan gesture
  private panStartPos: { x: number; y: number } | null = null;
  private panStartScroll: { x: number; y: number } | null = null;

  private rafId = 0;
  private baseDirty = false;
  private skipRedraw = false;
  private disposed = false;
  private unsub: () => void;
  private abort = new AbortController();

  constructor(
    private container: HTMLElement,
    readonly doc: InkDocument,
    private events: InkCanvasEvents = {},
  ) {
    this.base = this.makeCanvas('ink-base');
    this.live = this.makeCanvas('ink-live');
    this.baseCtx = this.base.getContext('2d')!;
    // `desynchronized` asks the browser for a low-latency path where available; harmless elsewhere.
    this.liveCtx = this.live.getContext('2d', { desynchronized: true } as CanvasRenderingContext2DSettings)!;
    this.cursor = document.createElement('div');
    this.cursor.className = 'eraser-ring';
    container.append(this.base, this.live, this.cursor);
    this.rect = this.live.getBoundingClientRect();

    this.live.style.touchAction = 'none';
    this.live.addEventListener('pointerdown', this.onDown, { signal: this.abort.signal });
    this.live.addEventListener('pointermove', this.onMove, { signal: this.abort.signal });
    this.live.addEventListener('pointerup', this.onUp, { signal: this.abort.signal });
    this.live.addEventListener('pointercancel', this.onUp, { signal: this.abort.signal });
    this.live.addEventListener('pointerleave', this.onLeave, { signal: this.abort.signal });
    this.live.addEventListener('contextmenu', (e) => e.preventDefault(), { signal: this.abort.signal });
    // Use capture for scroll to avoid interfering
    window.addEventListener('scroll', this.refreshRect, { passive: true, signal: this.abort.signal, capture: true });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.armDprWatcher();
    this.resize();

    this.unsub = doc.subscribe(() => {
      if (this.skipRedraw) {
        this.skipRedraw = false;
        return;
      }
      this.baseDirty = true;
      this.schedule();
    });
  }

  private makeCanvas(cls: string) {
    const c = document.createElement('canvas');
    c.className = `ink-layer ${cls}`;
    return c;
  }

  get width() {
    return this.cssW;
  }
  get height() {
    return this.cssH;
  }

  // ---- sizing / DPR ----------------------------------------------------------------------
  private refreshRect = () => {
    this.rect = this.live.getBoundingClientRect();
  };

  /** Re-read size + devicePixelRatio and resize every layer's backing store. */
  resize(): void {
    if (this.disposed) return;
    this.refreshRect();
    const cssW = Math.max(1, this.container.clientWidth);
    const cssH = Math.max(1, this.container.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    if (cssW === this.cssW && cssH === this.cssH && dpr === this.dpr && this.base.width > 0) return;
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    const bs = backingStore(cssW, cssH, dpr);
    for (const c of [this.base, this.live]) {
      c.width = bs.width;
      c.height = bs.height;
      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
    }
    for (const ctx of [this.baseCtx, this.liveCtx]) ctx.setTransform(bs.scaleX, 0, 0, bs.scaleY, 0, 0);
    this.refreshRect();
    this.paintBase();
    this.events.onResize?.(cssW, cssH, dpr);
  }

  /** The browser zoom / moving the window to another monitor changes devicePixelRatio. */
  private armDprWatcher() {
    this.dprMql?.removeEventListener('change', this.onDprChange);
    this.dprMql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.dprMql.addEventListener('change', this.onDprChange, { once: true });
  }
  private onDprChange = () => {
    this.resize();
    this.armDprWatcher();
  };

  // ---- painting --------------------------------------------------------------------------
  private schedule() {
    if (!this.rafId && !this.disposed) this.rafId = requestAnimationFrame(this.frame);
  }

  private frame = () => {
    this.rafId = 0;
    if (this.disposed) return;
    if (this.baseDirty) {
      this.baseDirty = false;
      this.paintBase();
    }
    if (this.activeId !== null && this.activeTool === 'pen') this.flushLive(false);
  };

  private paintBase() {
    const ctx = this.baseCtx;
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    for (const s of this.doc.strokes) {
      const c = this.palette[s.color ?? 'ink'];
      ctx.strokeStyle = c;
      ctx.fillStyle = c;
      drawStroke(ctx, s);
    }
  }

  /** Set the theme's colour for every ink colour key and repaint. */
  setPalette(p: Palette) {
    this.palette = { ...p };
    this.repaint();
  }

  /** Repaint committed strokes now (e.g. after the palette changed). */
  repaint() {
    this.baseDirty = true;
    this.schedule();
  }

  private flushLive(final: boolean) {
    const ctx = this.liveCtx;
    ctx.strokeStyle = this.palette[this.penColor];
    ctx.fillStyle = this.palette[this.penColor];
    const n = this.livePts.length / STRIDE;
    this.liveDrawn = drawSmooth(ctx, this.livePts, this.liveDrawn, n, this.strokeWidth, this.usePressure, final);
  }

  private clearLive() {
    this.liveCtx.clearRect(0, 0, this.cssW, this.cssH);
  }

  // ---- pointer handling ------------------------------------------------------------------
  private eraserRadius() {
    return 9 + this.strokeWidth * 1.6;
  }

  private logical(e: { clientX: number; clientY: number }) {
    return clientToLogical(e.clientX, e.clientY, this.rect, this.cssW, this.cssH);
  }

  private onDown = (e: PointerEvent) => {
    if (this.activeId !== null) return; // single active pointer (ignores extra fingers)
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const now = performance.now();
    if (e.pointerType === 'pen') this.lastPenTime = now;
    // Palm rejection: while a pen is in use, ignore touch contacts.
    if (e.pointerType === 'touch' && now - this.lastPenTime < 1000) return;
    e.preventDefault();
    this.refreshRect();
    this.live.setPointerCapture(e.pointerId);
    this.activeId = e.pointerId;
    this.activeType = e.pointerType;
    // Pen's eraser end / barrel eraser button acts as the stroke eraser.
    this.activeTool = e.pointerType === 'pen' && (e.buttons & 32 || e.button === 5) ? 'stroke-eraser' : this.tool;
    
    if (this.activeTool === 'pan') {
      const stage = this.container.closest('.stage');
      if (stage) {
        this.panStartPos = { x: e.clientX, y: e.clientY };
        this.panStartScroll = { x: stage.scrollLeft, y: stage.scrollTop };
      }
      return;
    }

    this.events.onStrokeStart?.();

    const { x, y } = this.logical(e);
    if (this.activeTool === 'pen') {
      this.usePressure = e.pointerType === 'pen';
      this.livePts = [];
      this.liveDrawn = 0;
      this.pushPoint(x, y, e.pressure);
      // Immediate dot so a tap shows ink with zero latency.
      this.liveCtx.fillStyle = this.palette[this.penColor];
      this.liveCtx.beginPath();
      this.liveCtx.arc(x, y, this.strokeWidth / 2, 0, Math.PI * 2);
      this.liveCtx.fill();
    } else {
      this.doc.beginGroup();
      this.lastErase = null;
      this.eraseAt(x, y);
      this.showCursor(x, y);
    }
    this.schedule();
  };

  private pushPoint(x: number, y: number, pressure: number) {
    const n = this.livePts.length;
    // Drop exact duplicates (stationary pen jitter) to keep strokes small.
    if (n >= STRIDE && this.livePts[n - STRIDE] === x && this.livePts[n - STRIDE + 1] === y) return;
    this.livePts.push(x, y, pressure > 0 ? pressure : 0.5);
  }

  private onMove = (e: PointerEvent) => {
    if (this.activeId === null) {
      // hover (mouse / pen): just position the eraser ring
      if (this.tool === 'stroke-eraser' && e.pointerType !== 'touch') {
        const { x, y } = this.logical(e);
        this.showCursor(x, y);
      } else {
        this.cursor.style.opacity = '0';
      }
      return;
    }
    if (e.pointerId !== this.activeId) return;

    if (this.activeTool === 'pan' && this.panStartPos && this.panStartScroll) {
      const stage = this.container.closest('.stage');
      if (stage) {
        stage.scrollLeft = this.panStartScroll.x - (e.clientX - this.panStartPos.x);
        stage.scrollTop = this.panStartScroll.y - (e.clientY - this.panStartPos.y);
      }
      return;
    }

    // Coalesced events give every hardware sample between frames → smoother curves for fast pens.
    const batch = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const list = batch.length ? batch : [e];
    for (const ev of list) {
      const { x, y } = this.logical(ev);
      if (this.activeTool === 'pen') this.pushPoint(x, y, ev.pressure);
      else this.eraseAt(x, y);
    }
    if (this.activeTool !== 'pen') {
      const { x, y } = this.logical(e);
      this.showCursor(x, y);
    }
    this.schedule();
  };

  private onLeave = () => {
    if (this.activeId === null) this.cursor.style.opacity = '0';
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.activeId) return;
    try {
      this.live.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    this.activeId = null;

    if (this.activeTool === 'pan') {
      this.panStartPos = null;
      this.panStartScroll = null;
      return;
    }

    if (this.activeTool === 'pen') {
      if (e.type !== 'pointercancel') this.commitPen();
      else this.clearLive();
    } else {
      this.doc.endGroup();
      this.lastErase = null;
      if (this.activeType === 'touch') this.cursor.style.opacity = '0';
    }
    this.livePts = [];
    this.events.onStrokeEnd?.();
  };

  private commitPen() {
    if (this.livePts.length === 0) return;
    const simplified = simplifyPoints(this.livePts, 0.15);
    const stroke: Stroke = {
      id: this.doc.newId(),
      pts: Float32Array.from(simplified),
      width: this.strokeWidth,
      pressure: this.usePressure,
      color: this.penColor,
    };
    if (this.events.interceptStroke?.(stroke)) {
      this.clearLive();
      return;
    }
    // Draw the finished stroke onto the base layer directly (no full repaint), then clear live.
    this.baseCtx.strokeStyle = this.palette[this.penColor];
    this.baseCtx.fillStyle = this.palette[this.penColor];
    drawStroke(this.baseCtx, stroke);
    this.clearLive();
    this.skipRedraw = true;
    this.doc.add(stroke);
  }

  /** Eraser sampling along the path since the previous sample so fast drags can't skip strokes. */
  private eraseAt(x: number, y: number) {
    const r = this.eraserRadius();
    const prev = this.lastErase;
    const steps = prev ? Math.max(1, Math.ceil(Math.hypot(x - prev.x, y - prev.y) / (r * 0.6))) : 1;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const px = prev ? prev.x + (x - prev.x) * t : x;
      const py = prev ? prev.y + (y - prev.y) * t : y;
      if (this.activeTool === 'stroke-eraser') {
        const ids = strokesTouching(this.doc.strokes, px, py, r * 0.55);
        if (ids.length) this.doc.remove(ids);
      } else {
        const removedIds: number[] = [];
        const frags: Stroke[] = [];
        for (const s of this.doc.strokes) {
          const f = erasePixels(s, px, py, r * 0.6, () => this.doc.newId());
          if (f) {
            removedIds.push(s.id);
            frags.push(...f);
          }
        }
        if (removedIds.length) this.doc.replace(removedIds, frags);
      }
    }
    this.lastErase = { x, y };
  }

  private showCursor(x: number, y: number) {
    const d = this.eraserRadius() * 0.55 * 2;
    const s = this.cursor.style;
    s.width = s.height = `${d}px`;
    s.transform = `translate(${x - d / 2}px, ${y - d / 2}px)`;
    s.opacity = '1';
  }

  setTool(tool: Tool) {
    this.tool = tool;
    if (tool === 'pen') this.cursor.style.opacity = '0';
    this.live.dataset.tool = tool;
    this.live.style.touchAction = tool === 'pan' ? 'pan-x pan-y' : 'none';
  }

  /** Flatten strokes (+ optional extra layers) to a PNG data URL at device resolution. */
  exportPng(extraLayers: HTMLCanvasElement[] = [], background = '#fffdf7'): string {
    const out = document.createElement('canvas');
    out.width = this.base.width;
    out.height = this.base.height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(this.base, 0, 0);
    for (const l of extraLayers) ctx.drawImage(l, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  dispose() {
    this.disposed = true;
    this.abort.abort();
    this.ro.disconnect();
    this.dprMql?.removeEventListener('change', this.onDprChange);
    cancelAnimationFrame(this.rafId);
    this.unsub();
    this.base.remove();
    this.live.remove();
    this.cursor.remove();
  }
}
