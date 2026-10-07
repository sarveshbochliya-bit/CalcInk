/** Formats a finite number for display: no float noise (0.1+0.2 → 0.3), no "-0", compact exponent. */
export function formatNumber(value: number): string {
  if (Object.is(value, -0) || value === 0) return '0';
  const abs = Math.abs(value);
  if (Number.isInteger(value) && abs < 1e15) return String(value);
  if (abs >= 1e15 || abs < 1e-9) {
    const [m, e] = value.toExponential(9).split('e');
    const mantissa = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
    return `${mantissa}e${Number(e)}`;
  }
  // 12 significant digits removes binary floating-point noise while keeping real precision.
  const rounded = parseFloat(value.toPrecision(12));
  return String(rounded);
}
