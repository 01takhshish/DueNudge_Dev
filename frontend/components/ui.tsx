import { clsx } from 'clsx';
import Link from 'next/link';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-500/60',
  secondary: 'bg-white text-ink-900 border border-ink-300 hover:bg-ink-100 disabled:opacity-60',
  ghost: 'text-ink-700 hover:bg-ink-100 disabled:opacity-60',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-60',
};
const base =
  'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed';

export function Button({
  variant = 'primary',
  className,
  loading,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      className={clsx(base, variants[variant], className)}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {loading && (
        <span
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = 'primary',
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={clsx(base, variants[variant], className)}>
      {children}
    </Link>
  );
}

export function Card({
  className,
  children,
  title,
  action,
}: {
  className?: string;
  children: ReactNode;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <section className={clsx('rounded-xl border border-ink-300/60 bg-white shadow-sm', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          {title && <h2 className="text-sm font-semibold text-ink-900">{title}</h2>}
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label className="block text-sm" htmlFor={htmlFor}>
      <span className="mb-1 block font-medium text-ink-700">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-500">{hint}</span>
      ) : null}
    </label>
  );
}

const control =
  'w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm shadow-xs placeholder:text-ink-500/70 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:bg-ink-100';
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(control, props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(control, props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(control, 'min-h-24', props.className)} />;
}

const badgeTones: Record<string, string> = {
  draft: 'bg-ink-100 text-ink-700',
  sent: 'bg-blue-50 text-blue-700',
  viewed: 'bg-indigo-50 text-indigo-700',
  overdue: 'bg-red-50 text-red-700',
  paid: 'bg-emerald-50 text-emerald-700',
  void: 'bg-ink-100 text-ink-500 line-through',
  pending: 'bg-amber-50 text-amber-700',
  sending: 'bg-amber-50 text-amber-700',
  skipped: 'bg-ink-100 text-ink-500',
  failed: 'bg-red-50 text-red-700',
  active: 'bg-emerald-50 text-emerald-700',
  trialing: 'bg-blue-50 text-blue-700',
  past_due: 'bg-red-50 text-red-700',
  canceled: 'bg-ink-100 text-ink-500',
  owner: 'bg-brand-50 text-brand-700',
  admin: 'bg-indigo-50 text-indigo-700',
  member: 'bg-ink-100 text-ink-700',
  free: 'bg-ink-100 text-ink-700',
  pro: 'bg-brand-50 text-brand-700',
  business: 'bg-purple-50 text-purple-700',
};
export function Badge({ value, className }: { value: string; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        badgeTones[value] ?? 'bg-ink-100 text-ink-700',
        className,
      )}
    >
      {value.replace('_', ' ')}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-ink-300 px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink-900">{title}</p>
      {body && <p className="mt-1 text-sm text-ink-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'info' | 'success';
  children: ReactNode;
}) {
  const tones = {
    error: 'border-red-200 bg-red-50 text-red-800',
    info: 'border-blue-200 bg-blue-50 text-blue-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  };
  return <div className={clsx('rounded-lg border px-3 py-2 text-sm', tones[tone])}>{children}</div>;
}

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-ink-500">
          <tr className="border-b border-ink-100">{head}</tr>
        </thead>
        <tbody className="divide-y divide-ink-100">{children}</tbody>
      </table>
    </div>
  );
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={clsx('px-3 py-2 font-medium', className)}>{children}</th>
);
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={clsx('px-3 py-3 align-middle', className)}>{children}</td>
);

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'danger' | 'success';
}) {
  return (
    <div className="rounded-xl border border-ink-300/60 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={clsx(
          'mt-2 text-2xl font-semibold tabular-nums',
          tone === 'danger' && 'text-red-600',
          tone === 'success' && 'text-emerald-600',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-ink-500">{sub}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (p: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-between text-sm text-ink-500">
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link
            className="rounded-lg border border-ink-300 px-3 py-1 hover:bg-ink-100"
            href={hrefFor(page - 1)}
          >
            Previous
          </Link>
        )}
        {page < pages && (
          <Link
            className="rounded-lg border border-ink-300 px-3 py-1 hover:bg-ink-100"
            href={hrefFor(page + 1)}
          >
            Next
          </Link>
        )}
      </div>
    </nav>
  );
}
