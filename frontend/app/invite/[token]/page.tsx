import Link from 'next/link';
import { cookies } from 'next/headers';
import { AuthForm } from '@/components/auth-form';
import { AcceptInvite } from '@/components/accept-invite';
import { publicApi } from '@/lib/api-server';

interface InviteInfo {
  email: string;
  role: string;
  tenantName: string;
  expiresAt: string;
}

export const metadata = { title: 'Invitation' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await publicApi<InviteInfo>(`/api/v1/auth/invites/${encodeURIComponent(token)}`);
  const loggedIn = (await cookies()).has('dn_refresh');
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8 text-2xl font-semibold tracking-tight">
        Due<span className="text-brand-600">Nudge</span>
      </Link>
      <div className="w-full max-w-md rounded-2xl border border-ink-300/60 bg-white p-8 shadow-sm">
        {!invite ? (
          <>
            <h1 className="text-xl font-semibold">This invitation isn&apos;t valid</h1>
            <p className="mt-2 text-sm text-ink-500">
              It may have expired or already been used. Ask the workspace owner to send a new one.
            </p>
          </>
        ) : loggedIn ? (
          <AcceptInvite token={token} invite={invite} />
        ) : (
          <AuthForm
            mode="signup"
            invite={{ token, email: invite.email, tenantName: invite.tenantName }}
            googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID)}
          />
        )}
      </div>
    </main>
  );
}
