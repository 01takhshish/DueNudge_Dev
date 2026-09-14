'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { TeamDto } from '@duenudge/shared';
import { api, ApiError } from '@/lib/api-client';
import { date } from '@/lib/format';
import { useMe } from '@/components/me-context';
import { Alert, Badge, Button, Card, Field, Input, Select, Table, Td, Th } from '@/components/ui';

export function TeamManager({ team }: { team: TeamDto }) {
  const me = useMe();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const canManage = me.role !== 'member';

  async function run(fn: () => Promise<unknown>) {
    setLoading(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code !== 'PLAN_LIMIT_REACHED') setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  const invite = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    void run(async () => {
      await api.post('/api/v1/team/invites', { email: f.get('email'), role: f.get('role') });
      form.reset();
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card title="Members">
          {error && (
            <div className="mb-3">
              <Alert>{error}</Alert>
            </div>
          )}
          <Table
            head={
              <>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Joined</Th>
                <Th />
              </>
            }
          >
            {team.members.map((m) => (
              <tr key={m.userId}>
                <Td>
                  <span className="font-medium">{m.name}</span>
                  <span className="block text-xs text-ink-500">{m.email}</span>
                </Td>
                <Td>
                  {me.role === 'owner' && m.role !== 'owner' ? (
                    <Select
                      value={m.role}
                      onChange={(e) =>
                        void run(() =>
                          api.patch(`/api/v1/team/members/${m.userId}`, { role: e.target.value }),
                        )
                      }
                      className="w-32"
                    >
                      <option value="admin">admin</option>
                      <option value="member">member</option>
                    </Select>
                  ) : (
                    <Badge value={m.role} />
                  )}
                </Td>
                <Td>{date(m.joinedAt)}</Td>
                <Td className="text-right">
                  {canManage &&
                    m.role !== 'owner' &&
                    (m.role !== 'admin' || me.role === 'owner') &&
                    m.userId !== me.user.id && (
                      <button
                        className="text-xs text-red-600 underline"
                        onClick={() =>
                          confirm(`Remove ${m.name}?`) &&
                          void run(() => api.del(`/api/v1/team/members/${m.userId}`))
                        }
                      >
                        Remove
                      </button>
                    )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        {team.invites.length > 0 && (
          <Card title="Pending invitations">
            <Table
              head={
                <>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Expires</Th>
                  <Th />
                </>
              }
            >
              {team.invites.map((i) => (
                <tr key={i.id}>
                  <Td>{i.email}</Td>
                  <Td>
                    <Badge value={i.role} />
                  </Td>
                  <Td>{date(i.expiresAt)}</Td>
                  <Td className="text-right">
                    {canManage && (
                      <button
                        className="text-xs text-red-600 underline"
                        onClick={() => void run(() => api.del(`/api/v1/team/invites/${i.id}`))}
                      >
                        Revoke
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
      </div>
      <Card title="Invite someone">
        {canManage ? (
          <form onSubmit={invite} className="space-y-3">
            <Field label="Email">
              <Input name="email" type="email" required placeholder="bookkeeper@studio.com" />
            </Field>
            <Field
              label="Role"
              hint="Admins can manage clients, invoices and settings. Members can create and send invoices."
            >
              <Select name="role" defaultValue="member">
                <option value="member">Member</option>
                {me.role === 'owner' && <option value="admin">Admin</option>}
              </Select>
            </Field>
            <Button type="submit" className="w-full" loading={loading}>
              Send invitation
            </Button>
          </form>
        ) : (
          <p className="text-sm text-ink-500">Ask an owner or admin to invite people.</p>
        )}
      </Card>
    </div>
  );
}
