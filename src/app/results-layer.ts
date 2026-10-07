import { LOW_CONFIDENCE, type EquationView } from './equations';

const COLORS: Record<EquationView['kind'], string> = {
  ok: '--answer',
  undefined: '--warn',
  error: '--warn',
  'check-ok': '--good',
  'check-wrong': '--warn',
};

const ANIM_MS = 260;

/**
 * Canvas layer between the committed ink and the live stroke that paints the projected answers
 * (next to each '='). It is repainted only when answers change or the canvas resizes; a short
 * pop-in animation runs on its own requestAnimationFrame loop that stops when idle.
 */
export class ResultsLayer {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private views: EquationView[] = [];
  private born = new Map<string, number>();
  private raf = 0;
  private w = 1;
  private h = 1;

  constructor() {
    this.canvas.className = 'ink-layer results-layer';
    // Make sure the handwriting-style font is ready before first paint, then repaint.
    void document.fonts?.load('600 40px Caveat').then(() => this.redraw());
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  set(views: EquationView[]) {
    const now = performance.now();
    const next = new Map<string, number>();
    for (const v of views) {
      const id = `${v.key}|${v.display}`;
      next.set(id, this.born.get(id) ?? now);
    }
    this.born = next;
    this.views = views;
    this.kick();
  }

  redraw() {
    this.kick();
  }

  private kick() {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private tick(_t: number) {
    this.raf = 0;
    if (this.paint(performance.now())) this.kick();
  }

  /** Returns true while any answer is still animating. */
  private paint(now: number): boolean {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    const style = getComputedStyle(document.documentElement);
    let animating = false;
    for (const v of this.views) {
      const age = now - (this.born.get(`${v.key}|${v.display}`) ?? now);
      const t = Math.min(1, Math.max(0, age / ANIM_MS));
      if (t < 1) animating = true;
      const ease = 1 - Math.pow(1 - t, 3);
      const low = v.minConfidence < LOW_CONFIDENCE;
      ctx.save();
      ctx.globalAlpha = (low ? 0.7 : 1) * ease;
      ctx.fillStyle = style.getPropertyValue(COLORS[v.kind]).trim() || '#c2410c';
      ctx.font = `600 ${v.fontSize}px Caveat, "Segoe Script", "Bradley Hand", cursive`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const label = low && v.kind !== 'undefined' ? `${v.display} ?` : v.display;
      const natural = ctx.measureText(label).width;
      // Answer left of the '=' (e.g. "136 = 17×8"): right-aligned to the anchor. If the page has no
      // room on that side, fall back to after the row so it never runs off the canvas.
      let side = v.side;
      let at = v.anchor;
      let avail = side === 'left' ? at.x - 8 : this.w - at.x - 8;
      if (side === 'left' && avail < Math.min(natural, 64) && v.fallback) {
        side = 'right';
        at = v.fallback;
        avail = this.w - at.x - 8;
      }
      avail = Math.max(20, avail);
      // Shrink to fit the free space so long answers never run off the page.
      const fit = natural > avail ? Math.max(0.4, avail / natural) : 1;
      const scale = (0.85 + 0.15 * ease) * fit;
      ctx.textAlign = side === 'left' ? 'right' : 'left';
      ctx.translate(at.x, at.y);
      ctx.scale(scale, scale);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    return animating;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
  }
}
