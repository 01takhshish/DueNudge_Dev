import { formatMoney } from '../lib/money.js';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout(title: string, bodyHtml: string, footer = 'Sent via DueNudge'): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1f26">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="560" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #e6e8ec" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 32px 8px;font-size:18px;font-weight:600">${escapeHtml(title)}</td></tr>
<tr><td style="padding:8px 32px 28px;font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #eef0f3;font-size:12px;color:#6b7280">${escapeHtml(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600">${escapeHtml(label)}</a></p>`;
}

/** User-authored plain text -> safe HTML paragraphs. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function invoiceSentEmail(p: {
  businessName: string;
  clientName: string;
  number: string;
  totalCents: number;
  currency: string;
  dueDate: string;
  publicUrl: string;
  paymentLink: string | null;
}): RenderedEmail {
  const total = formatMoney(p.totalCents, p.currency);
  const subject = `Invoice ${p.number} from ${p.businessName} — ${total} due ${p.dueDate}`;
  const text = `Hi ${p.clientName},\n\n${p.businessName} has sent you invoice ${p.number} for ${total}, due on ${p.dueDate}.\n\nView the invoice: ${p.publicUrl}\n${p.paymentLink ? `Pay online: ${p.paymentLink}\n` : ''}\nThank you!`;
  const html = layout(
    `Invoice ${p.number}`,
    `<p>Hi ${escapeHtml(p.clientName)},</p><p><strong>${escapeHtml(p.businessName)}</strong> has sent you invoice <strong>${escapeHtml(p.number)}</strong> for <strong>${total}</strong>, due on <strong>${p.dueDate}</strong>.</p>${button(p.publicUrl, 'View invoice')}${p.paymentLink ? `<p><a href="${escapeHtml(p.paymentLink)}">Pay online</a></p>` : ''}<p>Thank you!</p>`,
    `Sent by ${p.businessName} via DueNudge`,
  );
  return { subject, html, text };
}

export function reminderEmail(p: {
  businessName: string;
  clientName: string;
  number: string;
  totalCents: number;
  amountPaidCents: number;
  currency: string;
  dueDate: string;
  daysUntilDue: number; // negative => overdue
  publicUrl: string;
  paymentLink: string | null;
  kind: 'before_due' | 'on_due' | 'overdue' | 'manual';
}): RenderedEmail {
  const balance = formatMoney(p.totalCents - p.amountPaidCents, p.currency);
  let subject: string;
  let opening: string;
  if (p.kind === 'before_due') {
    subject = `Reminder: invoice ${p.number} (${balance}) is due in ${p.daysUntilDue} day${p.daysUntilDue === 1 ? '' : 's'}`;
    opening = `Just a friendly heads-up that invoice ${p.number} for ${balance} is due on ${p.dueDate}.`;
  } else if (p.kind === 'on_due') {
    subject = `Invoice ${p.number} (${balance}) is due today`;
    opening = `Invoice ${p.number} for ${balance} is due today, ${p.dueDate}.`;
  } else {
    const days = Math.abs(p.daysUntilDue);
    subject = `Overdue: invoice ${p.number} (${balance}) was due ${days} day${days === 1 ? '' : 's'} ago`;
    opening = `Invoice ${p.number} for ${balance} was due on ${p.dueDate} and is now ${days} day${days === 1 ? '' : 's'} overdue. Could you let us know when we can expect payment?`;
  }
  const text = `Hi ${p.clientName},\n\n${opening}\n\nView the invoice: ${p.publicUrl}\n${p.paymentLink ? `Pay online: ${p.paymentLink}\n` : ''}\nIf you've already paid, please ignore this message. Thank you!\n\n${p.businessName}`;
  const html = layout(
    subject,
    `<p>Hi ${escapeHtml(p.clientName)},</p><p>${escapeHtml(opening)}</p>${button(p.publicUrl, 'View invoice')}${p.paymentLink ? `<p><a href="${escapeHtml(p.paymentLink)}">Pay online</a></p>` : ''}<p>If you've already paid, please ignore this message. Thank you!</p><p>${escapeHtml(p.businessName)}</p>`,
    `Sent by ${p.businessName} via DueNudge`,
  );
  return { subject, html, text };
}

/** A reminder with user/AI-authored subject & body. */
export function customReminderEmail(p: {
  businessName: string;
  subject: string;
  body: string;
  publicUrl: string;
  paymentLink: string | null;
}): RenderedEmail {
  const text = `${p.body}\n\nView the invoice: ${p.publicUrl}${p.paymentLink ? `\nPay online: ${p.paymentLink}` : ''}`;
  const html = layout(
    p.subject,
    `${textToHtml(p.body)}${button(p.publicUrl, 'View invoice')}${p.paymentLink ? `<p><a href="${escapeHtml(p.paymentLink)}">Pay online</a></p>` : ''}`,
    `Sent by ${p.businessName} via DueNudge`,
  );
  return { subject: p.subject, html, text };
}

export function inviteEmail(p: {
  inviterName: string;
  tenantName: string;
  role: string;
  acceptUrl: string;
}): RenderedEmail {
  const subject = `${p.inviterName} invited you to ${p.tenantName} on DueNudge`;
  const text = `${p.inviterName} invited you to join ${p.tenantName} as ${p.role}.\n\nAccept: ${p.acceptUrl}\n\nThis link expires in 7 days.`;
  const html = layout(
    `Join ${p.tenantName}`,
    `<p><strong>${escapeHtml(p.inviterName)}</strong> invited you to join <strong>${escapeHtml(p.tenantName)}</strong> as <em>${escapeHtml(p.role)}</em>.</p>${button(p.acceptUrl, 'Accept invitation')}<p style="color:#6b7280;font-size:13px">This link expires in 7 days.</p>`,
  );
  return { subject, html, text };
}

export function welcomeEmail(p: { name: string; appUrl: string }): RenderedEmail {
  const subject = 'Welcome to DueNudge';
  const text = `Hi ${p.name},\n\nYour workspace is ready. Add your first client and send an invoice — we'll handle the reminders.\n\n${p.appUrl}/app`;
  const html = layout(
    'Welcome to DueNudge',
    `<p>Hi ${escapeHtml(p.name)},</p><p>Your workspace is ready. Add your first client and send an invoice — we'll handle the reminders.</p>${button(`${p.appUrl}/app`, 'Open DueNudge')}`,
  );
  return { subject, html, text };
}

export function paymentFailedEmail(p: {
  name: string;
  tenantName: string;
  billingUrl: string;
}): RenderedEmail {
  const subject = `Action needed: payment failed for ${p.tenantName}`;
  const text = `Hi ${p.name},\n\nWe couldn't charge your card for ${p.tenantName}. Please update your payment method to keep your plan.\n\n${p.billingUrl}`;
  const html = layout(
    'Payment failed',
    `<p>Hi ${escapeHtml(p.name)},</p><p>We couldn't charge your card for <strong>${escapeHtml(p.tenantName)}</strong>. Please update your payment method to keep your plan.</p>${button(p.billingUrl, 'Update payment method')}`,
  );
  return { subject, html, text };
}
