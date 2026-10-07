import { MathError, type Token } from './types';

/**
 * Recursive-descent parser + evaluator (no eval, no Function).
 *
 *   expr   := term   (('+' | '-') term)*
 *   term   := unary  (('*' | '/') unary)*
 *   unary  := '-' unary | number
 *
 * '*' / '/' bind tighter than '+' / '-' (BODMAS/PEMDAS), all operators are left-associative,
 * unary minus is allowed wherever an operand is expected ("-5+10", "3×-2", "5--3").
 * A unary plus is rejected ("5++3" is malformed handwriting, not arithmetic).
 */
export function evaluateTokens(tokens: Token[]): number {
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];

  function parseExpr(): number {
    let left = parseTerm();
    for (let t = peek(); t && t.type === 'op' && (t.op === '+' || t.op === '-'); t = peek()) {
      pos++;
      const right = parseTerm();
      left = t.op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseUnary();
    for (let t = peek(); t && t.type === 'op' && (t.op === '*' || t.op === '/'); t = peek()) {
      pos++;
      const right = parseUnary();
      if (t.op === '*') {
        left = left * right;
      } else {
        if (right === 0) throw new MathError('undefined', 'Division by zero');
        left = left / right;
      }
    }
    return left;
  }

  function parseUnary(): number {
    const t = peek();
    if (!t) throw new MathError('malformed', 'Expression ended where a number was expected');
    if (t.type === 'op') {
      if (t.op === '-') {
        pos++;
        return -parseUnary();
      }
      throw new MathError('malformed', `Unexpected operator "${t.op}"`);
    }
    pos++;
    return t.value;
  }

  if (tokens.length === 0) throw new MathError('malformed', 'Empty expression');
  const value = parseExpr();
  if (pos < tokens.length) throw new MathError('malformed', 'Unexpected trailing input');
  return value;
}
