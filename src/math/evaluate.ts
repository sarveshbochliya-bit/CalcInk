import { formatNumber } from './format';
import { evaluateTokens } from './parser';
import { tokenize } from './tokenizer';
import { MathError, type EvalResult } from './types';

/**
 * Evaluates an arithmetic expression string. NEVER throws and never uses eval():
 * - division by zero  → { ok:false, kind:'undefined', text:'Undefined' }
 * - malformed input   → { ok:false, kind:'malformed', text:'Error' }
 * - non-finite result → { ok:false, kind:'overflow',  text:'Overflow' }
 */
export function evaluateExpression(src: string): EvalResult {
  try {
    const value = evaluateTokens(tokenize(src));
    if (!Number.isFinite(value)) throw new MathError('overflow', 'Result is too large');
    return { ok: true, value, text: formatNumber(value) };
  } catch (err) {
    if (err instanceof MathError) {
      const text = err.kind === 'undefined' ? 'Undefined' : err.kind === 'overflow' ? 'Overflow' : 'Error';
      return { ok: false, kind: err.kind, text, message: err.message };
    }
    return { ok: false, kind: 'malformed', text: 'Error', message: 'Unexpected failure' };
  }
}

/**
 * Evaluates "18+4×3=" style input: exactly one trailing '=' is stripped (and required to be last).
 * Any other '=' makes the equation malformed.
 */
export function evaluateEquation(src: string): EvalResult {
  const trimmed = src.trim();
  const body = trimmed.endsWith('=') ? trimmed.slice(0, -1) : trimmed;
  if (body.includes('=')) {
    return { ok: false, kind: 'malformed', text: 'Error', message: 'Misplaced "="' };
  }
  return evaluateExpression(body);
}
