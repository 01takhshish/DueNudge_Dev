import { AuthForm } from '@/components/auth-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <AuthForm
      mode="login"
      next={next}
      googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID)}
      initialError={error === 'google' ? 'Google sign-in was cancelled or failed.' : null}
    />
  );
}
