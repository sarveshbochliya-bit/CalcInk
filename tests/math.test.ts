import { describe, expect, it } from 'vitest';
import { evaluateEquation, evaluateExpression, formatNumber, tokenize } from '../src/math';

const val = (s: string) => {
  const r = evaluateExpression(s);
  if (!r.ok) throw new Error(`expected ok for "${s}", got ${r.text}`);
  return r.value;
};

describe('operator precedence (BODMAS/PEMDAS)', () => {
  it.each([
    ['18+4×3', 30],
    ['2+3×4', 14],
    ['10÷2+5', 10],
    ['10/2+5', 10],
    ['2×3+4×5', 26],
    ['2+3×4-6÷2', 11],
    ['100÷4÷5', 5], // left associative
    ['8-3-2', 3], // left associative
    ['2-3×4', -10],
    ['6÷3×2', 4], // same precedence, left to right
    ['1+2+3+4', 10],
  ])('%s = %d', (src, expected) => expect(val(src)).toBe(expected));
});

describe('numbers', () => {
  it('multi-digit integers', () => expect(val('123+456')).toBe(579));
  it('decimals', () => {
    expect(val('12.5+3.5')).toBe(16);
    expect(val('0.5×4')).toBe(2);
    expect(val('7.25-0.25')).toBe(7);
  });
  it('leading-dot and trailing-dot numbers', () => {
    expect(val('.5+.5')).toBe(1);
    expect(val('5.+1')).toBe(6);
  });
  it('removes binary floating-point noise', () => {
    const r = evaluateExpression('0.1+0.2');
    expect(r.ok && r.text).toBe('0.3');
    const r2 = evaluateExpression('1.1×1.1');
    expect(r2.ok && r2.text).toBe('1.21');
  });
  it('non-terminating decimals are rounded for display', () => {
    const r = evaluateExpression('10÷3');
    expect(r.ok && r.text).toBe('3.33333333333');
  });
});

describe('negative numbers / unary minus', () => {
  it.each([
    ['-5+10', 5],
    ['-5', -5],
    ['3×-2', -6],
    ['5--3', 8],
    ['5+-3', 2],
    ['-2×-3', 6],
    ['-2.5×2', -5],
    ['10÷-2', -5],
    ['--4', 4],
  ])('%s = %d', (src, expected) => expect(val(src)).toBe(expected));
  it('unicode minus sign is accepted', () => expect(val('9−4')).toBe(5));
});

describe('division by zero', () => {
  it.each(['5÷0', '5/0', '0÷0', '1+2÷0', '4÷(0)'.replace('(0)', '0'), '3÷0.0', '2÷0×5', '1÷-0'])(
    '%s → Undefined',
    (src) => {
      const r = evaluateExpression(src);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('undefined');
        expect(r.text).toBe('Undefined');
      }
    },
  );
  it('does not flag legitimate zero numerators', () => expect(val('0÷5')).toBe(0));
  it('divides by a tiny non-zero number fine', () => expect(val('1÷0.5')).toBe(2));
});

describe('malformed expressions fail gracefully (no throw)', () => {
  it.each([
    '',
    '   ',
    '+',
    '×',
    '5+',
    '5×',
    '+5',
    '×5',
    '5++3',
    '5×÷3',
    '5÷×3',
    '1.2.3+4',
    '.',
    '5..',
    '1 2', // two numbers, no operator (after whitespace removal they stay separate tokens)
    '5a',
    '5(3)',
    '5=3',
    'abc',
  ])('"%s" → Error', (src) => {
    let r;
    expect(() => (r = evaluateExpression(src))).not.toThrow();
    expect(r).toMatchObject({ ok: false, kind: 'malformed', text: 'Error' });
  });
});

describe('overflow', () => {
  it('huge products overflow cleanly rather than showing Infinity', () => {
    const big = '9'.repeat(200);
    const r = evaluateExpression(`${big}×${big}`);
    expect(r).toMatchObject({ ok: false, kind: 'overflow', text: 'Overflow' });
  });
});

describe('evaluateEquation (terminal "=")', () => {
  it('strips one trailing =', () => {
    const r = evaluateEquation('18+4×3=');
    expect(r.ok && r.text).toBe('30');
  });
  it('works without = too', () => expect(evaluateEquation('2+2').ok).toBe(true));
  it('rejects misplaced =', () => {
    expect(evaluateEquation('2=3+1').ok).toBe(false);
    expect(evaluateEquation('2+3==').ok).toBe(false);
  });
  it('propagates Undefined for division by zero', () => {
    const r = evaluateEquation('7÷0=');
    expect(r).toMatchObject({ ok: false, text: 'Undefined' });
  });
});

describe('tokenize', () => {
  it('splits numbers and operators', () => {
    expect(tokenize('12.5+3×4')).toEqual([
      { type: 'num', value: 12.5, raw: '12.5' },
      { type: 'op', op: '+' },
      { type: 'num', value: 3, raw: '3' },
      { type: 'op', op: '*' },
      { type: 'num', value: 4, raw: '4' },
    ]);
  });
  it('is not an injection surface', () => {
    for (const evil of ['alert(1)', 'process.exit()', '1;2', 'constructor', '__proto__', '`1`', '1e5']) {
      expect(evaluateExpression(evil)).toMatchObject({ ok: false, kind: 'malformed' });
    }
  });
});

describe('formatNumber', () => {
  it('formats integers, negatives, zero', () => {
    expect(formatNumber(42)).toBe('42');
    expect(formatNumber(-7)).toBe('-7');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(0)).toBe('0');
  });
  it('uses compact exponents for very large/small values', () => {
    expect(formatNumber(1e20)).toBe('1e20');
    expect(formatNumber(1.5e-12)).toBe('1.5e-12');
  });
});
