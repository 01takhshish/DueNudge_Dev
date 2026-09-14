import { clsx } from 'clsx';

/** Brand mark: a bell-shaped "nudge" with a checkmark — used for favicon, OG image and headers. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={className}
    >
      <rect width="32" height="32" rx="8" fill="#2563eb" />
      <path
        d="M16 6.5c-3.6 0-6 2.7-6 6.2v3.4l-1.9 3.4c-.4.7.1 1.5.9 1.5h14c.8 0 1.3-.8.9-1.5L22 16.1v-3.4c0-3.5-2.4-6.2-6-6.2z"
        fill="#fff"
      />
      <path d="M13.2 23.5a2.9 2.9 0 0 0 5.6 0z" fill="#fff" />
      <path
        d="M12.6 14.2l2.3 2.2 4.6-4.6"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 text-lg font-semibold tracking-tight',
        className,
      )}
    >
      <LogoMark />
      <span className={light ? 'text-white' : 'text-ink-900'}>
        Due<span className={light ? 'text-brand-100' : 'text-brand-600'}>Nudge</span>
      </span>
    </span>
  );
}
