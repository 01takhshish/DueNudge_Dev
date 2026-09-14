import { describe, expect, it } from 'vitest';
import { effectivePlan } from '../../src/modules/usage/service.js';

describe('effectivePlan', () => {
  it('keeps paid entitlements while active, trialing or past_due (Stripe retrying)', () => {
    expect(effectivePlan('pro', 'active')).toBe('pro');
    expect(effectivePlan('pro', 'trialing')).toBe('pro');
    expect(effectivePlan('business', 'past_due')).toBe('business');
  });
  it('falls back to free when canceled/unpaid/incomplete', () => {
    expect(effectivePlan('pro', 'canceled')).toBe('free');
    expect(effectivePlan('pro', 'unpaid')).toBe('free');
    expect(effectivePlan('pro', 'incomplete')).toBe('free');
    expect(effectivePlan('free', 'active')).toBe('free');
  });
});
