import type { Role } from '@duenudge/shared';
import type { Tx } from '../../db/tx.js';
import { sha256 } from '../../lib/crypto.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { audit } from '../audit/service.js';

export interface InviteRow {
  id: string;
  tenant_id: string;
  email: string;
  role: 'admin' | 'member';
  expires_at: string;
  accepted_at: string | null;
  tenant_name: string;
}

export async function getInviteByToken(tx: Tx, rawToken: string): Promise<InviteRow | null> {
  return tx.maybeOne<InviteRow>(
    `SELECT i.id, i.tenant_id, i.email, i.role, i.expires_at, i.accepted_at, t.name AS tenant_name
     FROM invites i JOIN tenants t ON t.id = i.tenant_id
     WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > now()`,
    [sha256(rawToken)],
  );
}

/** Must run in a system tx (invites are tenant-scoped and the acceptor is not yet a member). */
export async function acceptInvite(
  tx: Tx,
  rawToken: string,
  user: { id: string; email: string },
): Promise<{ tenantId: string; role: Role }> {
  const invite = await getInviteByToken(tx, rawToken);
  if (!invite) throw notFound('Invitation');
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new AppError(
      403,
      'INVITE_EMAIL_MISMATCH',
      `This invitation was sent to ${invite.email}. Sign in with that email to accept it.`,
    );
  }
  const existing = await tx.maybeOne(
    `SELECT 1 FROM memberships WHERE tenant_id = $1 AND user_id = $2`,
    [invite.tenant_id, user.id],
  );
  if (existing) throw conflict('You are already a member of this workspace', 'ALREADY_MEMBER');
  await tx.execute(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)`, [
    invite.tenant_id,
    user.id,
    invite.role,
  ]);
  await tx.execute(`UPDATE invites SET accepted_at = now() WHERE id = $1`, [invite.id]);
  await audit(tx, {
    tenantId: invite.tenant_id,
    actorUserId: user.id,
    action: 'member.joined',
    entityType: 'membership',
    entityId: user.id,
    metadata: { role: invite.role },
  });
  return { tenantId: invite.tenant_id, role: invite.role };
}
