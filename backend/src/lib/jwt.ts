import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@duenudge/shared';
import { config } from '../config.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);
const ISSUER = 'duenudge';

export interface AccessClaims {
  sub: string; // user id
  tid: string; // active tenant id
  role: Role;
  pa: boolean; // platform admin
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ tid: claims.tid, role: claims.role, pa: claims.pa })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
    if (typeof payload.sub !== 'string' || typeof payload.tid !== 'string') return null;
    return {
      sub: payload.sub,
      tid: payload.tid,
      role: payload.role as Role,
      pa: Boolean(payload.pa),
    };
  } catch {
    return null;
  }
}
