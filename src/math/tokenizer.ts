import { MathError, type Token } from './types';

/** Characters that the recogniser (or a tester) may hand us, mapped to canonical operators. */
const OP_MAP: Record<string, '+' | '-' | '*' | '/'> = {
  '+': '+',
  '-': '-',
  '−': '-', // U+2212 minus
  '–': '-', // en dash
  '×': '*',
  '*': '*',
  '·': '*',
  '÷': '/',
  '/': '/',
};

const isDigit = (c: string) => c >= '0' && c <= '9';

/**
 * Turns "12.5+3×4" into tokens. Whitespace is ignored.
 * Any unknown character or a malformed number ("1.2.3", ".") raises MathError('malformed').
 */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') {
      i++;
      continue;
    }
    if (isDigit(c) || c === '.') {
      let j = i;
      let dots = 0;
      let digits = 0;
      while (j < src.length && (isDigit(src[j]) || src[j] === '.')) {
        if (src[j] === '.') dots++;
        else digits++;
        j++;
      }
      const raw = src.slice(i, j);
      if (dots > 1 || digits === 0) throw new MathError('malformed', `Bad number "${raw}"`);
      // Number() on a validated [0-9.] string is safe and deterministic (no code execution).
      tokens.push({ type: 'num', value: Number(raw), raw });
      i = j;
      continue;
    }
    const op = OP_MAP[c];
    if (op) {
      tokens.push({ type: 'op', op });
      i++;
      continue;
    }
    throw new MathError('malformed', `Unexpected character "${c}"`);
  }
  return tokens;
}
