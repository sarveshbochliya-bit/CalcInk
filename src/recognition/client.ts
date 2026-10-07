import type { Stroke } from '../ink/types';
import type { WorkerRequest, WorkerResponse } from './worker';
import type { RecognitionResult } from './types';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

interface Waiter {
  id: number;
  resolve: (r: RecognitionResult | null) => void;
}

/**
 * Main-thread handle to the recognition worker.
 *
 *  - Only ONE request is ever in flight; while it runs, newer requests replace each other in a
 *    single "queued" slot (latest wins). Superseded callers get `null`, so the UI never renders a
 *    stale answer and the worker never builds a backlog while the user keeps writing.
 *  - Point buffers are copied once and then *transferred* (zero-copy) to the worker.
 */
export class RecognitionClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private inFlight: Waiter | null = null;
  private queued: (Waiter & { strokes: Array<{ id: number; pts: Float32Array }> }) | null = null;
  private initDone: { resolve: () => void; reject: (e: Error) => void } | null = null;
  status: EngineStatus = 'idle';

  constructor(
    private readonly urls: { symbols: string; digits: string },
    private readonly onStatus: (s: EngineStatus, detail?: string) => void = () => {},
  ) {}

  /** Spawns the worker and resolves once both ONNX models are loaded and warmed up. */
  start(): Promise<void> {
    if (this.worker) return Promise.resolve();
    this.setStatus('loading');
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
    worker.onerror = (e) => this.fail(e.message || 'Recognition worker crashed');
    return new Promise<void>((resolve, reject) => {
      this.initDone = { resolve, reject };
      this.post({ type: 'init', symbolsUrl: this.urls.symbols, digitsUrl: this.urls.digits });
    });
  }

  /** Recognise the given strokes. Resolves to null when superseded by a newer call or on failure. */
  recognize(strokes: readonly Stroke[]): Promise<RecognitionResult | null> {
    if (!this.worker || this.status !== 'ready') return Promise.resolve(null);
    const payload = strokes.map((s) => ({ id: s.id, pts: s.pts.slice() }));
    return new Promise((resolve) => {
      const waiter = { id: this.nextId++, resolve };
      if (this.inFlight) {
        this.queued?.resolve(null);
        this.queued = { ...waiter, strokes: payload };
      } else {
        this.send(waiter, payload);
      }
    });
  }

  /** Forget cached symbol results (e.g. after loading a different page). */
  reset() {
    this.post({ type: 'reset' });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.inFlight?.resolve(null);
    this.queued?.resolve(null);
    this.inFlight = this.queued = null;
    this.setStatus('idle');
  }

  private send(waiter: Waiter, strokes: Array<{ id: number; pts: Float32Array }>) {
    this.inFlight = waiter;
    this.post({ type: 'recognize', id: waiter.id, strokes }, strokes.map((s) => s.pts.buffer));
  }

  private post(msg: WorkerRequest, transfer: Transferable[] = []) {
    this.worker?.postMessage(msg, transfer);
  }

  private onMessage(msg: WorkerResponse) {
    if (msg.type === 'ready') {
      this.setStatus('ready', `${Math.round(msg.ms)} ms`);
      this.initDone?.resolve();
      this.initDone = null;
    } else if (msg.type === 'result') {
      this.finish(msg.result);
    } else if (msg.type === 'error') {
      if (msg.id === undefined) this.fail(msg.message);
      else this.finish(null);
    }
  }

  private finish(result: RecognitionResult | null) {
    const done = this.inFlight;
    this.inFlight = null;
    done?.resolve(result);
    const next = this.queued;
    this.queued = null;
    if (next) this.send(next, next.strokes);
  }

  private fail(message: string) {
    this.setStatus('error', message);
    this.initDone?.reject(new Error(message));
    this.initDone = null;
    this.inFlight?.resolve(null);
    this.queued?.resolve(null);
    this.inFlight = this.queued = null;
  }

  private setStatus(s: EngineStatus, detail?: string) {
    this.status = s;
    this.onStatus(s, detail);
  }
}
