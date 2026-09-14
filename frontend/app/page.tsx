import Link from 'next/link';
import Image from 'next/image';
import {
  BellRing,
  Sparkles,
  Link2,
  Users,
  ShieldCheck,
  CreditCard,
  ArrowRight,
} from 'lucide-react';
import { PLANS, PLAN_IDS } from '@duenudge/shared';
import { LinkButton } from '@/components/ui';
import { Logo } from '@/components/logo';
import {
  HeroPreview,
  IsolationIllustration,
  TimelineIllustration,
} from '@/components/landing-visuals';

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
const primaryHref = DEMO ? '/demo' : '/signup';
const primaryLabel = DEMO ? 'Try the live demo' : 'Start free';

const features = [
  [
    BellRing,
    'Automatic reminders',
    'Before due, on the day, and after — on your schedule, at 9 AM in your timezone. They stop the moment an invoice is paid.',
  ],
  [
    Sparkles,
    'AI-drafted follow-ups',
    'One click writes a reminder that knows the client: how late they usually pay, what you already sent, how firm to be.',
  ],
  [
    Link2,
    'Public invoice pages',
    'Clients get a clean link and a “Pay online” button; you get a “viewed” timestamp instead of wondering.',
  ],
  [
    Users,
    'Team-ready',
    'Invite an assistant or bookkeeper with owner / admin / member roles. Every change lands in the audit log.',
  ],
  [
    ShieldCheck,
    'Isolation you can prove',
    'Every tenant’s data is fenced by Postgres row-level security — enforced by the database, covered by tests.',
  ],
  [
    CreditCard,
    'Honest billing',
    'Start free. Upgrade when you outgrow it — Stripe handles the card, plan limits are enforced server-side.',
  ],
] as const;

const screenshots = [
  ['dashboard.png', 'Dashboard', 'Outstanding, overdue, collected — and what goes out next.'],
  ['invoice.png', 'Invoice detail', 'Reminder timeline, AI drafting and one-click nudges.'],
  [
    'public-invoice.png',
    'What your client sees',
    'A clean, printable invoice page with a pay button.',
  ],
] as const;

export default function LandingPage() {
  return (
    <main className="overflow-x-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" aria-label="DueNudge home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <a href="#how" className="hidden text-ink-700 hover:text-ink-900 sm:inline">
            How it works
          </a>
          <a href="#pricing" className="hidden text-ink-700 hover:text-ink-900 sm:inline">
            Pricing
          </a>
          <Link href="/login" className="text-ink-700 hover:text-ink-900">
            Sign in
          </Link>
          <LinkButton href={primaryHref}>{primaryLabel}</LinkButton>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-24 pt-10 text-center sm:pt-16">
        <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
          For freelancers and small studios{' '}
          {DEMO && (
            <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] text-white">
              Live demo
            </span>
          )}
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
          Send the invoice. We&apos;ll do the awkward follow-ups.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-ink-500">
          DueNudge sends polite, well-timed payment reminders automatically — and drafts the firm
          ones with AI when a client goes quiet. Get paid sooner without becoming a collections
          agent.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <LinkButton href={primaryHref} className="px-5 py-2.5">
            {primaryLabel} <ArrowRight size={16} />
          </LinkButton>
          <LinkButton
            href={DEMO ? '#screens' : '/login'}
            variant="secondary"
            className="px-5 py-2.5"
          >
            {DEMO ? 'See screenshots' : 'Sign in'}
          </LinkButton>
        </div>
        <p className="mt-3 text-xs text-ink-500">
          {DEMO
            ? 'No signup. A sample workspace with real-looking invoices, reminders and history.'
            : 'Free plan · no card required · 14-day Pro trial when you upgrade'}
        </p>
        <div className="mt-14">
          <HeroPreview />
        </div>
      </section>

      <section id="how" className="border-y border-ink-100 bg-white py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight">
            One send. The rest is handled.
          </h2>
          <p className="mt-2 text-center text-ink-500">
            Reminders follow the invoice&apos;s due date, in your timezone, and stop the moment
            it&apos;s paid.
          </p>
          <div className="mx-auto mt-10 max-w-3xl">
            <TimelineIllustration />
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              [
                '1. Create & send',
                'Line items, tax, due date. Your client gets an email with a link to a clean invoice page.',
              ],
              [
                '2. Reminders go out',
                'A gentle heads-up before the due date, a note on the day, firmer follow-ups after — automatically.',
              ],
              [
                '3. Record the payment',
                'Mark it paid (or let the pay link do it). Pending reminders are cancelled instantly.',
              ],
            ].map(([t, b]) => (
              <div key={t} className="rounded-xl border border-ink-300/60 p-5">
                <h3 className="font-semibold">{t}</h3>
                <p className="mt-2 text-sm text-ink-500">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-5 px-6 py-20 sm:grid-cols-2 lg:grid-cols-3">
        {features.map(([Icon, title, body]) => (
          <div key={title} className="rounded-xl border border-ink-300/60 bg-white p-5 shadow-sm">
            <div className="mb-3 inline-flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Icon size={18} />
            </div>
            <h3 className="font-semibold text-ink-900">{title}</h3>
            <p className="mt-2 text-sm text-ink-500">{body}</p>
          </div>
        ))}
      </section>

      <section id="screens" className="border-y border-ink-100 bg-white py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight">A look inside</h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {screenshots.map(([file, title, body]) => (
              <figure key={file}>
                <div className="overflow-hidden rounded-xl border border-ink-300/60 shadow-md">
                  <Image
                    src={`/screenshots/${file}`}
                    alt={title}
                    width={1280}
                    height={800}
                    className="h-auto w-full"
                  />
                </div>
                <figcaption className="mt-3">
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm text-ink-500">{body}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-20 md:grid-cols-2">
        <div>
          <p className="text-sm font-medium text-brand-600">Built like a real product</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">
            Your data is fenced at the database.
          </h2>
          <p className="mt-4 text-ink-500">
            Every tenant table is protected by Postgres row-level security. The application role
            cannot bypass it, and a test suite proves a query without a tenant filter returns
            nothing — not everyone&apos;s invoices.
          </p>
          <ul className="mt-5 space-y-2 text-sm text-ink-700">
            {[
              'Rotating sessions with reuse detection',
              'Idempotent, order-tolerant Stripe webhooks',
              'Transactional outbox for every email',
              'Audit log written in the same transaction as the change',
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <span className="text-brand-600">✓</span>
                {t}
              </li>
            ))}
          </ul>
          <a
            href="https://github.com"
            className="mt-5 inline-block text-sm text-brand-600 underline"
            target="_blank"
            rel="noreferrer"
          >
            Read the architecture decisions →
          </a>
        </div>
        <div className="flex justify-center">
          <IsolationIllustration />
        </div>
      </section>

      <section id="pricing" className="border-t border-ink-100 bg-white py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight">Simple pricing</h2>
          <p className="mt-2 text-center text-ink-500">
            Limits are enforced server-side, so what you see is what you get.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {PLAN_IDS.map((id) => {
              const p = PLANS[id];
              const highlight = id === 'pro';
              return (
                <div
                  key={id}
                  className={
                    highlight
                      ? 'rounded-2xl border-2 border-brand-500 p-6 shadow-md'
                      : 'rounded-2xl border border-ink-300/60 p-6'
                  }
                >
                  <h3 className="text-lg font-semibold">{p.name}</h3>
                  <p className="text-sm text-ink-500">{p.tagline}</p>
                  <p className="mt-4 text-3xl font-semibold">
                    ${p.priceMonthlyUsd}
                    <span className="text-base font-normal text-ink-500">/mo</span>
                  </p>
                  <ul className="mt-5 space-y-2 text-sm text-ink-700">
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-2">
                        <span className="text-brand-600">✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <LinkButton
                    href={primaryHref}
                    variant={highlight ? 'primary' : 'secondary'}
                    className="mt-6 w-full"
                  >
                    {DEMO
                      ? 'Explore in the demo'
                      : id === 'free'
                        ? 'Start free'
                        : `Start ${p.name} trial`}
                  </LinkButton>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Stop chasing. Start nudging.</h2>
        <div className="mt-6 flex justify-center">
          <LinkButton href={primaryHref} className="px-6 py-3 text-base">
            {primaryLabel} <ArrowRight size={18} />
          </LinkButton>
        </div>
      </section>

      <footer className="border-t border-ink-100 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 text-xs text-ink-500">
          <Logo className="text-base" />
          <span>
            Built as a production-grade reference SaaS · Next.js · Fastify · Postgres · Stripe
          </span>
        </div>
      </footer>
    </main>
  );
}
