/** Result of evaluating a recognised expression. Never throws: failures are values. */
export type EvalResult =
  | { ok: true; value: number; text: string }
  | { ok: false; kind: 'undefined' | 'malformed' | 'overflow'; text: string; message: string };

export type Token =
  | { type: 'num'; value: number; raw: string }
  | { type: 'op'; op: '+' | '-' | '*' | '/' };

/** Internal error used by the tokenizer/parser; always caught by evaluate(). */
export class MathError extends Error {
  constructor(public readonly kind: 'undefined' | 'malformed' | 'overflow', message: string) {
    super(message);
    this.name = 'MathError';
  }
}
