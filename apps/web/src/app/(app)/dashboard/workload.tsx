import Link from 'next/link';
import type { WorkloadRow } from '@tasnivo/domain/dashboard';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { Table, Td, Th } from '@/ui/table';

/** Admins only: per accountant, what waits in their clients and when they last decided something. */
export async function Workload({ rows }: { rows: WorkloadRow[] }) {
  const { locale, ta } = await getI18n();
  const home = ta.firmX.home;
  if (rows.length === 0) {
    return (
      <p className="text-small text-muted">
        {home.workloadNone}{' '}
        <Link href="/team" className="font-medium text-brand-ink hover:underline">{ta.firmX.client.inviteColleague}</Link>
      </p>
    );
  }
  const fmt = (n: number): string => fmtNumber(locale, n);
  return (
    <Table label={home.workloadTitle}>
      <thead>
        <tr>
          <Th>{home.colAccountant}</Th>
          <Th numeric>{home.colClients}</Th>
          <Th numeric>{home.colOpen}</Th>
          <Th numeric>{home.colPending}</Th>
          <Th numeric>{home.colOverdue}</Th>
          <Th>{home.colLast}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.userId}>
            <Td className="max-w-[16rem] truncate font-medium" title={r.email}>
              <Link href={`/dashboard?accountant=${encodeURIComponent(r.userId)}`} className="hover:text-brand-ink hover:underline">{r.email}</Link>
            </Td>
            <Td numeric>{r.assigned === null ? `${fmt(r.clients)} (${home.allClients})` : fmt(r.clients)}</Td>
            <Td numeric>
              {r.openRows > 0
                ? <Link href={`/queue?accountant=${encodeURIComponent(r.userId)}`} className="font-medium text-danger-ink hover:underline">{fmt(r.openRows)}</Link>
                : fmt(0)}
            </Td>
            <Td numeric>{fmt(r.pendingFindings)}</Td>
            <Td numeric className={r.overdueTasks > 0 ? 'font-medium text-danger-ink' : undefined}>{fmt(r.overdueTasks)}</Td>
            <Td className="whitespace-nowrap text-muted">{r.lastDecisionAt ? fmtDate(locale, r.lastDecisionAt) : home.never}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
