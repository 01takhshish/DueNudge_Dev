import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'DueNudge — invoices that chase themselves';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: 'linear-gradient(135deg,#0f172a 0%,#1e3a8a 100%)',
        color: 'white',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 40, fontWeight: 700 }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: '#2563eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 30,
          }}
        >
          🔔
        </div>
        DueNudge
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: -2,
          }}
        >
          <div>Send the invoice.</div>
          <div>We&apos;ll do the awkward follow-ups.</div>
        </div>
        <div style={{ fontSize: 30, color: '#bfdbfe' }}>
          Automatic payment reminders + AI-drafted follow-ups for freelancers
        </div>
      </div>
      <div style={{ display: 'flex', gap: 28, fontSize: 24, color: '#93c5fd' }}>
        <span>Multi-tenant</span>
        <span>·</span>
        <span>Stripe billing</span>
        <span>·</span>
        <span>Postgres RLS</span>
        <span>·</span>
        <span>Live demo</span>
      </div>
    </div>,
    size,
  );
}
