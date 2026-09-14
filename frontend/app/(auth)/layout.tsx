import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8" aria-label="DueNudge home">
        <Logo className="text-2xl" />
      </Link>
      <div className="w-full max-w-md rounded-2xl border border-ink-300/60 bg-white p-8 shadow-sm">
        {children}
      </div>
    </main>
  );
}
