import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, localDateTimeToUtc, tzOffsetMinutes } from '../../src/lib/dates.js';

describe('dates', () => {
  it('converts 09:00 New York to UTC across DST', () => {
    expect(localDateTimeToUtc('2026-01-15', 9, 'America/New_York').toISOString()).toBe(
      '2026-01-15T14:00:00.000Z',
    ); // EST -5
    expect(localDateTimeToUtc('2026-07-15', 9, 'America/New_York').toISOString()).toBe(
      '2026-07-15T13:00:00.000Z',
    ); // EDT -4
  });
  it('handles UTC and positive offsets', () => {
    expect(localDateTimeToUtc('2026-03-01', 9, 'UTC').toISOString()).toBe(
      '2026-03-01T09:00:00.000Z',
    );
    expect(localDateTimeToUtc('2026-03-01', 9, 'Asia/Kolkata').toISOString()).toBe(
      '2026-03-01T03:30:00.000Z',
    );
  });
  it('tzOffsetMinutes', () => {
    expect(tzOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Asia/Kolkata')).toBe(330);
  });
  it('addDays crosses month/year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('daysBetween', () => {
    expect(daysBetween('2026-01-01', '2026-01-15')).toBe(14);
    expect(daysBetween('2026-01-15', '2026-01-01')).toBe(-14);
  });
});
