/**
 * Small timezone helpers with no dependencies. We only need one operation:
 * "09:00 local time on date D in tz T" -> UTC instant. Intl gives us the offset.
 */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - date.getTime()) / 60_000;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Returns the UTC instant for `YYYY-MM-DD` at `hour:00` in `timeZone`. */
export function localDateTimeToUtc(isoDate: string, hour: number, timeZone: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, hour, 0, 0));
  // Two passes handle DST transitions close to the target time.
  const offset1 = tzOffsetMinutes(guess, timeZone);
  const candidate = new Date(guess.getTime() - offset1 * 60_000);
  const offset2 = tzOffsetMinutes(candidate, timeZone);
  return offset1 === offset2 ? candidate : new Date(guess.getTime() - offset2 * 60_000);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function currentPeriod(date = new Date()): string {
  return date.toISOString().slice(0, 7); // YYYY-MM
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  return Math.round((b - a) / 86_400_000);
}
