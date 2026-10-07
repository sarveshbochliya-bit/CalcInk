/**
 * Haptic + audio micro-feedback. Everything is synthesised (no audio assets) and silent unless the
 * user has enabled it, so there is nothing to download and nothing that can fail offline.
 */
export class Feedback {
  soundOn = false;
  hapticOn = true;
  private audio: AudioContext | null = null;

  private ctx(): AudioContext | null {
    if (!this.audio) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.audio = new Ctor();
      } catch {
        return null;
      }
    }
    if (this.audio.state === 'suspended') void this.audio.resume();
    return this.audio;
  }

  private tone(freqs: number[], gain: number, dur: number) {
    if (!this.soundOn) return;
    const ctx = this.ctx();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(ctx.destination);
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t0 + i * 0.07);
      o.connect(g);
      o.start(t0 + i * 0.07);
      o.stop(t0 + dur + 0.05);
    });
  }

  private buzz(pattern: number | number[]) {
    if (!this.hapticOn) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* unsupported */
    }
  }

  /** A new answer was projected. */
  answer() {
    this.tone([784, 1175], 0.05, 0.22);
    this.buzz(12);
  }

  /** "Undefined" / "Error" result. */
  problem() {
    this.tone([330, 262], 0.045, 0.26);
    this.buzz([10, 40, 10]);
  }

  /** Something was erased or cleared. */
  erase() {
    this.tone([520], 0.03, 0.1);
    this.buzz(6);
  }
}
