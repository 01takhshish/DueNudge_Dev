'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api-client';
import { Alert, Button, Field, Input } from '@/components/ui';

interface Props {
  mode: 'login' | 'signup';
  next?: string;
  invite?: { token: string; email: string; tenantName: string } | null;
  googleEnabled: boolean;
  initialError?: string | null;
}

export function AuthForm({ mode, next, invite, googleEnabled, initialError }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});
    const form = new FormData(e.currentTarget);
    const body = Object.fromEntries(form.entries()) as Record<string, string>;
    try {
      if (mode === 'signup') {
        await api.post('/api/v1/auth/signup', {
          ...body,
          inviteToken: invite?.token,
          tenantName: body.tenantName || undefined,
        });
        router.push(invite ? '/app' : '/onboarding');
      } else {
        await api.post('/api/v1/auth/login', body);
        router.push(next && next.startsWith('/') ? next : '/app');
      }
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.validation.length)
          setFieldErrors(Object.fromEntries(err.validation.map((v) => [v.path, v.message])));
        setError(err.message);
      } else setError('Something went wrong');
      setLoading(false);
    }
  }

  const googleHref = `/api/v1/auth/google${invite ? `?invite=${encodeURIComponent(invite.token)}` : ''}`;
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">
          {mode === 'login'
            ? 'Welcome back'
            : invite
              ? `Join ${invite.tenantName}`
              : 'Create your workspace'}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {mode === 'login' ? (
            <>
              New here?{' '}
              <Link href="/signup" className="text-brand-600 underline">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <Link
                href={invite ? `/login?next=/invite/${invite.token}` : '/login'}
                className="text-brand-600 underline"
              >
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
      {demo && (
        <Alert tone="info">
          This is the live demo — any email and password will sign you into the sample workspace, or{' '}
          <a className="underline" href="/demo">
            skip straight in
          </a>
          .
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}
      {mode === 'signup' && (
        <Field label="Your name" error={fieldErrors.name}>
          <Input name="name" required autoComplete="name" placeholder="Ava Chen" />
        </Field>
      )}
      <Field label="Email" error={fieldErrors.email}>
        <Input
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={invite?.email}
          readOnly={Boolean(invite)}
          placeholder="you@studio.com"
        />
      </Field>
      <Field
        label="Password"
        error={fieldErrors.password}
        hint={mode === 'signup' ? 'At least 10 characters with a letter and a number' : undefined}
      >
        <Input
          name="password"
          type="password"
          required
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          minLength={mode === 'signup' ? 10 : 1}
        />
      </Field>
      {mode === 'signup' && !invite && (
        <Field
          label="Workspace name"
          hint="Your business or studio name. You can change it later."
          error={fieldErrors.tenantName}
        >
          <Input name="tenantName" placeholder="Acme Design Studio" />
        </Field>
      )}
      <Button type="submit" className="w-full" loading={loading}>
        {mode === 'login' ? 'Sign in' : 'Create account'}
      </Button>
      {googleEnabled && (
        <>
          <div className="relative py-1 text-center text-xs text-ink-500">
            <span className="bg-white px-2">or</span>
            <div className="absolute inset-x-0 top-1/2 -z-10 border-t border-ink-100" />
          </div>
          <a
            href={googleHref}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-ink-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-ink-100"
          >
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
              <path
                fill="#EA4335"
                d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-4 7.2-9.9 7.2-17.4z"
              />
              <path
                fill="#FBBC05"
                d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.7l7.8-6z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.2 0 11.6-2 15.4-5.6l-7.3-5.7c-2 1.4-4.7 2.3-8.1 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6C6.5 42.6 14.6 48 24 48z"
              />
            </svg>
            Continue with Google
          </a>
        </>
      )}
    </form>
  );
}
