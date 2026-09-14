import type { FastifyPluginAsync } from 'fastify';
import type { z } from 'zod';
import { logoUploadSchema, updateTenantSchema, type TenantDto } from '@duenudge/shared';
import { withSystem, withTenant } from '../../db/tx.js';
import { AppError, badRequest } from '../../lib/errors.js';
import { isValidTimeZone } from '../../lib/dates.js';
import { TENANT_SELECT } from '../auth/service.js';
import { audit } from '../audit/service.js';
import { presignLogoUpload } from './storage.js';

export const tenantRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', { schema: { tags: ['tenant'] } }, async (req): Promise<TenantDto> => {
    const auth = req.auth!;
    return withTenant(auth.tenantId, (tx) =>
      tx.one<TenantDto>(
        `SELECT ${TENANT_SELECT} FROM tenants WHERE id = $1`,
        [auth.tenantId],
        'Workspace',
      ),
    );
  });

  app.patch(
    '/',
    {
      preHandler: app.requireRole('admin'),
      schema: { body: updateTenantSchema, tags: ['tenant'] },
    },
    async (req): Promise<TenantDto> => {
      const body = req.body as z.infer<typeof updateTenantSchema>;
      const auth = req.auth!;
      if (body.timezone && !isValidTimeZone(body.timezone)) throw badRequest('Unknown timezone');
      const columns: Record<string, string> = {
        name: 'name',
        currency: 'currency',
        timezone: 'timezone',
        businessEmail: 'business_email',
        businessAddress: 'business_address',
        logoUrl: 'logo_url',
        reminderOffsets: 'reminder_offsets',
        defaultPaymentTermsDays: 'default_payment_terms_days',
      };
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [key, col] of Object.entries(columns)) {
        if (key in body) {
          params.push((body as Record<string, unknown>)[key]);
          sets.push(`${col} = $${params.length}`);
        }
      }
      if (!sets.length) throw badRequest('Nothing to update');
      params.push(auth.tenantId);
      return withSystem(async (tx) => {
        const tenant = await tx.one<TenantDto>(
          `UPDATE tenants SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${TENANT_SELECT}`,
          params,
          'Workspace',
        );
        await audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'tenant.updated',
          entityType: 'tenant',
          entityId: auth.tenantId,
          metadata: { fields: Object.keys(body) },
          ip: req.ip,
        });
        return tenant;
      });
    },
  );

  app.post(
    '/onboarding/complete',
    { schema: { tags: ['tenant'] } },
    async (req): Promise<TenantDto> => {
      const auth = req.auth!;
      return withSystem(async (tx) => {
        const tenant = await tx.one<TenantDto>(
          `UPDATE tenants SET onboarded_at = COALESCE(onboarded_at, now()) WHERE id = $1 RETURNING ${TENANT_SELECT}`,
          [auth.tenantId],
          'Workspace',
        );
        await audit(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'tenant.onboarded',
          entityType: 'tenant',
          entityId: auth.tenantId,
          ip: req.ip,
        });
        return tenant;
      });
    },
  );

  app.post(
    '/logo-upload',
    { preHandler: app.requireRole('admin'), schema: { body: logoUploadSchema, tags: ['tenant'] } },
    async (req) => {
      const body = req.body as z.infer<typeof logoUploadSchema>;
      const auth = req.auth!;
      const result = await presignLogoUpload(auth.tenantId, body.contentType, body.sizeBytes);
      if (!result)
        throw new AppError(503, 'STORAGE_NOT_CONFIGURED', 'File storage is not configured');
      return result;
    },
  );
};
