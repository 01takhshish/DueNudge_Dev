import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}
export interface SendResult {
  provider: string;
  messageId: string | null;
}
export interface EmailProvider {
  name: string;
  send(email: OutgoingEmail): Promise<SendResult>;
}

class ResendProvider implements EmailProvider {
  name = 'resend';
  private client = new Resend(config.RESEND_API_KEY);
  async send(email: OutgoingEmail): Promise<SendResult> {
    const { data, error } = await this.client.emails.send({ from: config.EMAIL_FROM, ...email });
    if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
    return { provider: this.name, messageId: data?.id ?? null };
  }
}

class SmtpProvider implements EmailProvider {
  name = 'smtp';
  private transport = nodemailer.createTransport(config.SMTP_URL);
  async send(email: OutgoingEmail): Promise<SendResult> {
    const info = await this.transport.sendMail({ from: config.EMAIL_FROM, ...email });
    return { provider: this.name, messageId: info.messageId ?? null };
  }
}

class ConsoleProvider implements EmailProvider {
  name = 'console';
  async send(email: OutgoingEmail): Promise<SendResult> {
    logger.info(
      { to: email.to, subject: email.subject },
      '[email] (no provider configured) would send',
    );
    return { provider: this.name, messageId: null };
  }
}

let provider: EmailProvider | null = null;
export function emailProvider(): EmailProvider {
  if (provider) return provider;
  if (config.RESEND_API_KEY) provider = new ResendProvider();
  else if (config.SMTP_URL) provider = new SmtpProvider();
  else provider = new ConsoleProvider();
  return provider;
}

/** Test seam. */
export function setEmailProvider(p: EmailProvider | null): void {
  provider = p;
}
