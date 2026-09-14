/** All money is stored as integer minor units (cents). Never floats. */
export function computeTotals<T extends { quantity: number; unitCents: number }>(
  items: T[],
  taxRateBps: number,
) {
  const lines = items.map((i) => ({ ...i, amountCents: Math.round(i.quantity * i.unitCents) }));
  const subtotalCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const taxCents = Math.round((subtotalCents * taxRateBps) / 10_000);
  return { lines, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export function formatMoney(cents: number, currency: string, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
