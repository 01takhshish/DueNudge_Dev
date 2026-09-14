import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@duenudge/shared';
import { verifyAccessToken } from '../lib/jwt.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: Role;
  isPlatformAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePlatformAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const ACCESS_COOKIE = 'dn_access';
export const REFRESH_COOKIE = 'dn_refresh';

const ROLE_RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

export const authPlugin = fp(async (app) => {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const token = bearer ?? req.cookies[ACCESS_COOKIE];
    if (!token) return;
    const claims = await verifyAccessToken(token);
    if (!claims) return;
    req.auth = {
      userId: claims.sub,
      tenantId: claims.tid,
      role: claims.role,
      isPlatformAdmin: claims.pa,
    };
    req.log = req.log.child({ userId: claims.sub, tenantId: claims.tid });
  });

  app.decorate('authenticate', async (req: FastifyRequest) => {
    if (!req.auth) throw unauthorized();
  });

  app.decorate('requireRole', (...roles: Role[]) => {
    const min = Math.min(...roles.map((r) => ROLE_RANK[r]));
    return async (req: FastifyRequest) => {
      if (!req.auth) throw unauthorized();
      if (ROLE_RANK[req.auth.role] < min)
        throw forbidden(`This action requires the ${roles.join(' or ')} role`);
    };
  });

  app.decorate('requirePlatformAdmin', async (req: FastifyRequest) => {
    if (!req.auth) throw unauthorized();
    if (!req.auth.isPlatformAdmin) throw forbidden('Platform admin only');
  });
});
