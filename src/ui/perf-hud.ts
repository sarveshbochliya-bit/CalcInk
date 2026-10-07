/**
 * Always-visible frame-rate meter (header chip) plus an optional detail panel (click the chip or press F).
 *
 * Idle pages trivially run at the display refresh rate, so the number that actually proves the
 * "60 FPS while recognising" requirement is the one measured WHILE the user is writing or the
 * worker is recognising. The meter therefore tracks two things separately:
 *   - live   : fps over the last ~500 ms (what the chip shows)
 *   - busy   : fps / worst frame / dropped frames accumulated only while drawing or recognising
 *
 * A frame counts as "dropped" when it took longer than DROP_MS (1.5 × the 60 Hz budget).
 * The rAF loop is a few arithmetic ops per frame and pauses automatically in hidden tabs.
 */
const DROP_MS = 25;
const WINDOW_MS = 500;

export type FpsState = 'good' | 'ok' | 'bad';

export class PerfHud {
  /** Header chip (live fps). Created by the caller's markup, found by id. */
  private chip: HTMLElement | null;
  /** Detail panel overlaid on the paper. */
  readonly el: HTMLDivElement;

  private raf = 0;
  private last = 0;
  private frames = 0;
  private windowStart = 0;
  private worst = 0;
  private worstHold = 0;
  fps = 0;

  // busy-only statistics
  private drawing = false;
  private recognizing = false;
  private busyFrames = 0;
  private busyTime = 0;
  private busyWorst = 0;
  private busyDropped = 0;

  inferenceMs: number | null = null;
  inferenceCount = 0;

  constructor(parent: HTMLElement, chipId = 'chip-fps') {
    this.chip = document.getElementById(chipId);
    this.el = document.createElement('div');
    this.el.className = 'perf-hud';
    this.el.hidden = true;
    this.el.setAttribute('aria-hidden', 'true');
    parent.append(this.el);
    this.chip?.addEventListener('click', () => this.toggle());
    document.addEventListener('visibilitychange', this.onVisibility);
    this.start();
  }

  get visible() {
    return !this.el.hidden;
  }
  get busy() {
    return this.drawing || this.recognizing;
  }

  setDrawing(v: boolean) {
    this.drawing = v;
  }
  setRecognizing(v: boolean) {
    this.recognizing = v;
  }

  /** Show / hide the detail panel (the chip is always visible). */
  toggle(force?: boolean) {
    const show = force ?? this.el.hidden;
    this.el.hidden = !show;
    this.chip?.setAttribute('aria-pressed', String(show));
    this.render();
  }

  /** Stats gathered only while writing/recognising since the last reset (used by tests / the panel). */
  get busyStats() {
    return {
      fps: this.busyTime > 0 ? (this.busyFrames * 1000) / this.busyTime : 0,
      worstMs: this.busyWorst,
      dropped: this.busyDropped,
      frames: this.busyFrames,
    };
  }

  resetBusyStats() {
    this.busyFrames = this.busyTime = this.busyWorst = this.busyDropped = 0;
  }

  private start() {
    this.last = performance.now();
    this.windowStart = this.last;
    this.frames = 0;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  private onVisibility = () => {
    if (document.hidden) cancelAnimationFrame(this.raf);
    else this.start();
  };

  private tick = (now: number) => {
    const dt = now - this.last;
    this.last = now;
    this.raf = requestAnimationFrame(this.tick);
    if (dt > 1000) return; // resumed from a hidden tab / debugger pause: not a real frame

    this.frames++;
    if (dt > this.worst) {
      this.worst = dt;
      this.worstHold = now;
    }
    if (now - this.worstHold > 2500) this.worst = dt;

    if (this.busy) {
      this.busyFrames++;
      this.busyTime += dt;
      if (dt > this.busyWorst) this.busyWorst = dt;
      if (dt > DROP_MS) this.busyDropped++;
    }

    if (now - this.windowStart >= WINDOW_MS) {
      this.fps = (this.frames * 1000) / (now - this.windowStart);
      this.frames = 0;
      this.windowStart = now;
      this.render();
    }
  };

  static stateFor(fps: number): FpsState {
    return fps >= 55 ? 'good' : fps >= 40 ? 'ok' : 'bad';
  }

  private render() {
    if (this.chip && this.fps > 0) {
      this.chip.textContent = `${Math.round(this.fps)} fps`;
      this.chip.dataset.state = PerfHud.stateFor(this.fps);
    }
    if (this.el.hidden) return;
    const b = this.busyStats;
    const inf = this.inferenceMs === null ? '–' : `${this.inferenceMs.toFixed(0)} ms`;
    this.el.textContent =
      `live ${this.fps.toFixed(0)} fps · worst ${this.worst.toFixed(0)} ms\n` +
      `while writing/recognising: ${b.frames ? b.fps.toFixed(0) : '–'} fps · worst ${b.worstMs.toFixed(0)} ms · dropped ${b.dropped}/${b.frames}\n` +
      `recognition ${inf} (worker) · ${this.inferenceCount} runs`;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.el.remove();
  }
}
