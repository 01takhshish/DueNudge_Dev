import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'DueNudge — invoices that chase themselves', template: '%s · DueNudge' },
  description:
    'Invoicing and automatic payment reminders for freelancers and small studios. Send an invoice; we handle the follow-ups.',
  metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3000'),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
