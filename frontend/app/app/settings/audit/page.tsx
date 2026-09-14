import type { AuditEntryDto, Paginated } from '@duenudge/shared';
import { serverApi } from '@/lib/api-server';
import { dateTime, humanAction } from '@/lib/format';
import { Card, PageHeader, Pagination, Table, Td, Th } from '@/components/ui';

export const metadata = { title: 'Audit log' };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page = '1' } = await searchParams;
  const data = await serverApi<Paginated<AuditEntryDto>>(`/api/v1/audit?page=${page}&pageSize=50`);
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change in this workspace, who made it, and when. Written in the same transaction as the change."
      />
      <Card>
        <Table
          head={
            <>
              <Th>When</Th>
              <Th>Action</Th>
              <Th>Actor</Th>
              <Th>Details</Th>
            </>
          }
        >
          {data.items.map((a) => (
            <tr key={a.id}>
              <Td className="whitespace-nowrap text-ink-500">{dateTime(a.createdAt)}</Td>
              <Td className="font-medium">{humanAction(a.action)}</Td>
              <Td>{a.actorName ?? <span className="text-ink-500">system</span>}</Td>
              <Td className="max-w-md truncate font-mono text-xs text-ink-500">
                {Object.entries(a.metadata)
                  .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                  .join('  ')}
              </Td>
            </tr>
          ))}
        </Table>
        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          hrefFor={(p) => `/app/settings/audit?page=${p}`}
        />
      </Card>
    </>
  );
}
