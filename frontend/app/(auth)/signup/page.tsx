import { AuthForm } from '@/components/auth-form';

export const metadata = { title: 'Create account' };

export default function SignupPage() {
  return <AuthForm mode="signup" googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID)} />;
}
