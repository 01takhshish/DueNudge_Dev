import { config } from '../../config.js';
import { badRequest } from '../../lib/errors.js';

/**
 * Hand-rolled Google OAuth 2.0 authorization-code flow (no passport). Two calls:
 *  1. authorizationUrl(state) — where we send the browser
 *  2. exchangeCode(code)      — server-to-server: code -> tokens -> userinfo
 */
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export const googleRedirectUri = () => `${config.API_PUBLIC_URL}/api/v1/auth/google/callback`;

export function authorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export async function exchangeCode(code: string): Promise<GoogleProfile> {
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CLIENT_ID!,
      client_secret: config.GOOGLE_CLIENT_SECRET!,
      redirect_uri: googleRedirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) throw badRequest('Google sign-in failed (token exchange)');
  const tokens = (await tokenRes.json()) as { access_token: string };
  const infoRes = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!infoRes.ok) throw badRequest('Google sign-in failed (profile)');
  const info = (await infoRes.json()) as {
    sub: string;
    email: string;
    email_verified?: boolean;
    name?: string;
  };
  if (!info.email) throw badRequest('Google account has no email');
  return {
    sub: info.sub,
    email: info.email.toLowerCase(),
    emailVerified: Boolean(info.email_verified),
    name: info.name ?? info.email.split('@')[0]!,
  };
}
