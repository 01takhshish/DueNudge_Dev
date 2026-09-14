import { describe, expect, it } from 'vitest';
import { kindForOffset, planReminders } from '../../src/modules/reminders/scheduling.js';

describe('planReminders', () => {
  const now = new Date('2026-05-01T00:00:00Z');
  it('classifies offsets', () => {
    expect(kindForOffset(-3)).toBe('before_due');
    expect(kindForOffset(0)).toBe('on_due');
    expect(kindForOffset(7)).toBe('overdue');
  });
  it('schedules each offset at 09:00 in the tenant timezone and drops past ones', () => {
    const plan = planReminders({
      dueDate: '2026-05-10',
      offsets: [14, -3, 0, 7, -30],
      timezone: 'UTC',
      now,
    });
    expect(plan.map((p) => p.offset)).toEqual([-3, 0, 7, 14]); // -30 => 2026-04-10, already past
    expect(plan[0]!.scheduledFor.toISOString()).toBe('2026-05-07T09:00:00.000Z');
    expect(plan[1]!.kind).toBe('on_due');
  });
  it('dedupes offsets', () => {
    expect(
      planReminders({ dueDate: '2026-05-10', offsets: [3, 3, 3], timezone: 'UTC', now }),
    ).toHaveLength(1);
  });
  it('returns nothing for an invoice sent long after its due date', () => {
    expect(
      planReminders({ dueDate: '2026-01-01', offsets: [-3, 0, 3, 7, 14], timezone: 'UTC', now }),
    ).toEqual([]);
  });
});
