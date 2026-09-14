import { describe, expect, it } from 'vitest';
import { emailJobId, reminderJobId } from '../../src/jobs/ids.js';

// BullMQ throws "Custom Id cannot contain :" at enqueue time — caught in a smoke test, pinned here.
describe('job ids', () => {
  const id = '3198e52e-2843-4d60-9fd8-2a0880d9048b';
  it('are unique per row and never contain a colon', () => {
    for (const jobId of [emailJobId(id), reminderJobId(id)]) {
      expect(jobId).toMatch(/^[A-Za-z0-9-]+$/);
      expect(jobId).toContain(id);
    }
    expect(emailJobId(id)).not.toBe(reminderJobId(id));
  });
});
