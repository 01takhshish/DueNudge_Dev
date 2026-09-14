import { describe, expect, it } from 'vitest';
import {
  customReminderEmail,
  escapeHtml,
  reminderEmail,
  textToHtml,
} from '../../src/email/templates.js';

describe('email templates', () => {
  it('escapes user content', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(textToHtml('a\n\nb<c')).toBe(
      '<p style="margin:0 0 14px">a</p><p style="margin:0 0 14px">b&lt;c</p>',
    );
  });
  it('renders reminder variants', () => {
    const base = {
      businessName: 'Acme',
      clientName: 'Bob',
      number: 'INV-0001',
      totalCents: 10000,
      amountPaidCents: 2500,
      currency: 'USD',
      dueDate: '2026-05-10',
      publicUrl: 'http://x/i/t',
      paymentLink: null,
    };
    expect(reminderEmail({ ...base, daysUntilDue: 3, kind: 'before_due' }).subject).toContain(
      'due in 3 days',
    );
    expect(reminderEmail({ ...base, daysUntilDue: 0, kind: 'on_due' }).subject).toContain(
      'due today',
    );
    expect(reminderEmail({ ...base, daysUntilDue: -7, kind: 'overdue' }).subject).toContain(
      '7 days ago',
    );
    expect(reminderEmail({ ...base, daysUntilDue: -7, kind: 'overdue' }).text).toContain('$75.00');
  });
  it('custom reminder keeps the authored subject and escapes body html', () => {
    const e = customReminderEmail({
      businessName: 'Acme',
      subject: 'Hi',
      body: 'Pay <now>',
      publicUrl: 'http://x',
      paymentLink: 'http://pay',
    });
    expect(e.subject).toBe('Hi');
    expect(e.html).toContain('Pay &lt;now&gt;');
    expect(e.text).toContain('http://pay');
  });
});
