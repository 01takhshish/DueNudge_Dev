/** Inline, dependency-free illustrations for the landing page. */

export function HeroPreview() {
  const rows: Array<[string, string, string, string, string]> = [
    ['INV-0006', 'Hooli', 'Sep 29', 'viewed', '$13,500.00'],
    ['INV-0005', 'Vandelay Industries', 'Aug 29', 'overdue', '$2,400.00'],
    ['INV-0004', 'Globex Corporation', 'Aug 18', 'overdue', '$3,900.00'],
    ['INV-0003', 'Hooli', 'Aug 18', 'paid', '$3,600.00'],
  ];
  const tone: Record<string, string> = {
    viewed: 'bg-indigo-50 text-indigo-700',
    overdue: 'bg-red-50 text-red-700',
    paid: 'bg-emerald-50 text-emerald-700',
  };
  return (
    <div className="relative mx-auto w-full max-w-3xl">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-brand-100 via-white to-indigo-100 blur-2xl" />
      <div className="overflow-hidden rounded-2xl border border-ink-300/60 bg-white shadow-xl">
        <div className="flex items-center gap-1.5 border-b border-ink-100 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-red-400" />
          <span className="size-2.5 rounded-full bg-amber-400" />
          <span className="size-2.5 rounded-full bg-emerald-400" />
          <span className="ml-3 rounded-md bg-ink-50 px-2 py-0.5 text-[11px] text-ink-500">
            app.duenudge.dev/app
          </span>
        </div>
        <div className="grid grid-cols-4 gap-3 p-4 text-left">
          {[
            ['Outstanding', '$19,800.00', ''],
            ['Overdue', '$6,300.00', 'text-red-600'],
            ['Collected this month', '$8,900.00', 'text-emerald-600'],
            ['Drafts', '1', ''],
          ].map(([l, v, c]) => (
            <div key={l} className="rounded-xl border border-ink-300/60 p-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-ink-500">{l}</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${c}`}>{v}</p>
            </div>
          ))}
        </div>
        <div className="px-4 pb-4 text-left">
          <div className="rounded-xl border border-ink-300/60">
            <div className="grid grid-cols-[1fr_1.4fr_0.8fr_0.8fr_1fr] gap-2 border-b border-ink-100 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-ink-500">
              <span>Invoice</span>
              <span>Client</span>
              <span>Due</span>
              <span>Status</span>
              <span className="text-right">Total</span>
            </div>
            {rows.map(([n, c, d, st, t]) => (
              <div
                key={n}
                className="grid grid-cols-[1fr_1.4fr_0.8fr_0.8fr_1fr] items-center gap-2 border-b border-ink-100 px-3 py-2 text-xs last:border-0"
              >
                <span className="font-medium text-brand-700">{n}</span>
                <span>{c}</span>
                <span className={st === 'overdue' ? 'text-red-600' : ''}>{d}</span>
                <span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${tone[st]}`}
                  >
                    {st}
                  </span>
                </span>
                <span className="text-right tabular-nums">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute -right-4 -top-6 hidden w-64 rotate-2 rounded-xl border border-ink-300/60 bg-white p-3 text-left shadow-lg md:block">
        <p className="text-[10px] font-medium uppercase tracking-wide text-brand-600">
          AI draft · firm
        </p>
        <p className="mt-1 text-xs font-semibold">
          Invoice INV-0005 — $2,400.00 now 9 days overdue
        </p>
        <p className="mt-1 line-clamp-3 text-[11px] text-ink-500">
          Hi Art, following up on invoice INV-0005, which was due on Aug 29 and is now 9 days
          overdue. Could you confirm a payment date by the end of this week?
        </p>
      </div>
      <div className="absolute -bottom-5 -left-4 hidden w-56 -rotate-2 rounded-xl border border-ink-300/60 bg-white p-3 text-left shadow-lg md:block">
        <p className="text-[10px] font-medium uppercase tracking-wide text-ink-500">
          Reminder schedule
        </p>
        <ul className="mt-1 space-y-1 text-[11px]">
          {[
            ['−3 days', 'sent'],
            ['Due day', 'sent'],
            ['+3 days', 'sent'],
            ['+7 days', 'pending'],
            ['+14 days', 'pending'],
          ].map(([l, s]) => (
            <li key={l} className="flex justify-between">
              <span>{l}</span>
              <span className={s === 'sent' ? 'text-emerald-600' : 'text-amber-600'}>{s}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function TimelineIllustration() {
  const points = [
    { x: 40, label: 'Sent', sub: 'client gets a link' },
    { x: 190, label: '−3 days', sub: 'friendly heads-up' },
    { x: 340, label: 'Due', sub: 'due-today note' },
    { x: 490, label: '+7 days', sub: 'firm follow-up' },
    { x: 640, label: 'Paid', sub: 'reminders stop' },
  ];
  return (
    <svg
      viewBox="0 0 700 120"
      className="w-full"
      role="img"
      aria-label="Reminder timeline from sent to paid"
    >
      <line
        x1="40"
        y1="46"
        x2="640"
        y2="46"
        stroke="#cbd5e1"
        strokeWidth="3"
        strokeDasharray="6 6"
      />
      <line x1="40" y1="46" x2="490" y2="46" stroke="#2563eb" strokeWidth="3" />
      {points.map((p, i) => (
        <g key={p.label}>
          <circle
            cx={p.x}
            cy="46"
            r="11"
            fill={i === 4 ? '#10b981' : i < 4 ? '#2563eb' : '#cbd5e1'}
          />
          {i === 4 ? (
            <path
              d="M634 46l4 4 8-8"
              stroke="#fff"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <circle cx={p.x} cy="46" r="4" fill="#fff" />
          )}
          <text x={p.x} y="82" textAnchor="middle" fontSize="13" fontWeight="600" fill="#0f172a">
            {p.label}
          </text>
          <text x={p.x} y="100" textAnchor="middle" fontSize="11" fill="#64748b">
            {p.sub}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function IsolationIllustration() {
  return (
    <svg
      viewBox="0 0 320 160"
      className="w-full max-w-sm"
      role="img"
      aria-label="Two tenants isolated by row-level security"
    >
      {[0, 1].map((i) => (
        <g key={i} transform={`translate(${20 + i * 170},20)`}>
          <rect
            width="120"
            height="110"
            rx="12"
            fill={i ? '#eef2ff' : '#eef4ff'}
            stroke={i ? '#a5b4fc' : '#93c5fd'}
          />
          <text x="60" y="24" textAnchor="middle" fontSize="12" fontWeight="600" fill="#0f172a">
            Tenant {i ? 'B' : 'A'}
          </text>
          {[0, 1, 2].map((r) => (
            <rect
              key={r}
              x="16"
              y={38 + r * 22}
              width="88"
              height="14"
              rx="4"
              fill={i ? '#c7d2fe' : '#bfdbfe'}
            />
          ))}
        </g>
      ))}
      <line
        x1="160"
        y1="10"
        x2="160"
        y2="150"
        stroke="#ef4444"
        strokeWidth="3"
        strokeDasharray="5 5"
      />
      <rect x="128" y="66" width="64" height="26" rx="13" fill="#fff" stroke="#ef4444" />
      <text x="160" y="83" textAnchor="middle" fontSize="11" fontWeight="600" fill="#ef4444">
        RLS
      </text>
    </svg>
  );
}
