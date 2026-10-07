import { describe, expect, it } from 'vitest';
import { describeRows } from '../src/app/equations';
import type { Label, RowResult, SymbolResult } from '../src/recognition/types';

/** Builds a recognised row from text, laying symbols out left→right on one line. */
function row(text: string, conf = 0.99): RowResult {
  const h = 40;
  const symbols: SymbolResult[] = [...text].map((ch, i) => {
    const bbox = { minX: 10 + i * 50, minY: 100, maxX: 10 + i * 50 + 30, maxY: 100 + h };
    return { strokeIds: [i + 1], bbox, label: ch as Label, confidence: conf, alternatives: [] };
  });
  const last = symbols[symbols.length - 1];
  const bbox = { minX: symbols[0].bbox.minX, minY: 100, maxX: last.bbox.maxX, maxY: 100 + h };
  return { symbols, text, bbox, symbolHeight: h, equals: last.label === '=' ? { bbox: last.bbox } : null };
}

describe('describeRows', () => {
  it('projects the answer after a trailing "="', () => {
    const [v] = describeRows([row('18+4×3=')]);
    expect(v.display).toBe('30');
    expect(v.kind).toBe('ok');
    expect(v.anchor.x).toBeGreaterThan(row('18+4×3=').bbox.maxX - 1);
  });

  it('evaluates an equals-FIRST row ("=1+3") and places the answer to the LEFT of the "="', () => {
    const r = row('=1+3');
    const [v] = describeRows([r]);
    expect(v.display).toBe('4');
    expect(v.kind).toBe('ok');
    expect(v.side).toBe('left');
    expect(v.anchor.x).toBeLessThan(r.symbols[0].bbox.minX); // right edge of the answer is before the '='
    expect(v.fallback!.x).toBeGreaterThan(r.bbox.maxX); // no-room fallback is after the row
  });

  it('keeps the answer on the RIGHT for the normal "2+3=" form', () => {
    const [v] = describeRows([row('2+3=')]);
    expect(v.side).toBe('right');
    expect(v.display).toBe('5');
  });

  it('handles precedence, decimals and division by zero in equals-first rows', () => {
    expect(describeRows([row('=2+3×4')])[0].display).toBe('14');
    expect(describeRows([row('=12.5+3.5')])[0].display).toBe('16');
    const z = describeRows([row('=5÷0')])[0];
    expect(z.display).toBe('Undefined');
    expect(z.kind).toBe('undefined');
  });

  it('does not throw on malformed equals-first rows', () => {
    expect(describeRows([row('=5+')])[0].kind).toBe('error');
    expect(describeRows([row('=')])).toEqual([]);
    expect(describeRows([row('=1+3=')])[0].kind).toBe('error'); // two '=' is malformed
  });

  it('checks the user\'s own answer ("2+2=4" ✓, "2+2=5" ✗)', () => {
    expect(describeRows([row('2+2=4')])[0].display).toBe('✓');
    expect(describeRows([row('2+2=5')])[0].display).toBe('✗');
  });

  it('ignores rows with no "=" yet', () => {
    expect(describeRows([row('18+4')])).toEqual([]);
  });
});
