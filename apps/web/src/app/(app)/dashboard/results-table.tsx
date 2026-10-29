import Link from 'next/link';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { getI18n } from '@/lib/locale';
import { ButtonLink } from '@/ui/button';
import { IconDownload } from '@/ui/icons';
import { Table, Td, Th } from '@/ui/table';
import { Card } from './card';
import type { Value } from './dashboard-data';

/**
 * Per client: audited catalogues, rows checked, issues found and resolved, the last audit; the latest
 * audits first, at most ten rows. The downloads carry every client the dashboard shows (with failed
 * rows and decisions too), under the same accountant filter.
 */
export async function ResultsTable({ value, accountant }: { value: Value; accountant: string | null }) {
  const { locale, ta } = await getI18n();
  const v = ta.firmX.value;
  const n = (x: number): string => fmtNumber(locale, x);
  const filter = accountant ? { accountant } : {};
  const more = value.clientsWithResults - value.clients.length;
  return (
    <Card
      id="results"
      title={v.clientsTitle}
      hint={v.clientsHint}
      flush
      actions={(
        <>
          <ButtonLink size="sm" href={api.workspace.dashboardResults.url({ format: 'xlsx', ...filter })} download leadingIcon={<IconDownload />}>{v.downloadXlsx}</ButtonLink>
          <ButtonLink size="sm" variant="ghost" href={api.workspace.dashboardResults.url({ format: 'csv', ...filter })} download>{v.downloadCsv}</ButtonLink>
        </>
      )}
      footer={more > 0 ? <p className="text-small text-muted">{v.clientsMore(n(more), more)}</p> : undefined}
    >
      <Table label={v.clientsTitle}>
        <thead>
          <tr>
            <Th>{v.cols.client}</Th>
            <Th numeric>{v.cols.catalogs}</Th>
            <Th numeric>{v.cols.rows}</Th>
            <Th numeric>{v.cols.issues}</Th>
            <Th numeric>{v.cols.resolved}</Th>
            <Th>{v.cols.last}</Th>
          </tr>
        </thead>
        <tbody>
          {value.clients.map((c) => (
            <tr key={c.clientId}>
              <Td className="max-w-[16rem] truncate font-medium" title={c.name}>
                <Link href={`/clients/${encodeURIComponent(c.clientId)}`} className="hover:text-brand-ink hover:underline">{c.name}</Link>
              </Td>
              <Td numeric>{n(c.catalogs)}</Td>
              <Td numeric>{n(c.rowsChecked)}</Td>
              <Td numeric>{n(c.issues)}</Td>
              <Td numeric className={c.issues > 0 && c.resolved === c.issues ? 'text-good-ink' : undefined}>{n(c.resolved)}</Td>
              <Td className="whitespace-nowrap text-muted">{c.lastAuditAt ? fmtDate(locale, c.lastAuditAt) : ta.firmX.home.never}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
