import type { Tx } from '../../db/tx.js';

export interface AuditInput {
  tenantId: string;
  actorUserId: string | null;
  action: string; // e.g. 'invoice.sent'
  entityType: string; // e.g. 'invoice'
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Written inside the same transaction as the change it records — an audit entry never exists without its change, or vice-versa. */
export async function audit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.execute(
    `INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, metadata, ip)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      input.tenantId,
      input.actorUserId,
      input.action,
      input.entityType,
      input.entityId ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.ip ?? null,
    ],
  );
}
