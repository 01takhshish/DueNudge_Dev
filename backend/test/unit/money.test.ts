import { describe, expect, it } from 'vitest';
import { computeTotals, formatMoney } from '../../src/lib/money.js';

describe('money', () => {
  it('computes line amounts, subtotal, tax and total in integer cents', () => {
    const t = computeTotals(
      [
        { quantity: 1.5, unitCents: 1000 },
        { quantity: 3, unitCents: 333 },
      ],
      825,
    );
    expect(t.lines.map((l) => l.amountCents)).toEqual([1500, 999]);
    expect(t.subtotalCents).toBe(2499);
    expect(t.taxCents).toBe(206); // 2499 * 0.0825 = 206.17
    expect(t.totalCents).toBe(2705);
  });
  it('never produces floats', () => {
    const t = computeTotals([{ quantity: 0.1, unitCents: 3 }], 0);
    expect(Number.isInteger(t.totalCents)).toBe(true);
  });
  it('formats currency', () => {
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56');
    expect(formatMoney(5000, 'EUR')).toBe('€50.00');
  });
});
