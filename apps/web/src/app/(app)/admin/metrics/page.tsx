import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import type { AccuracyRow } from '@/lib/pure/types';
import { fmtNumber, fmtPercent } from '@tasnivo/i18n/format';
import type { Locale } from '@tasnivo/i18n/i18n';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { IconDownload } from '@/ui/icons';
import { Page } from '@/ui/page';
import { Stat } from '@/ui/stat';
import { Table, Td, Th } from '@/ui/table';
import { Card, FLUSH_TABLE } from '../../_manage/card';
import { adminAllowed } from '../allowed';
import { DIMENSIONS, keyText, reasonText, type Dimension } from './accuracy-text';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${(await adminAllowed()) ? ta.metrics.title : ta.shellX.notFound.title} — ${t.appName}`, robots: { index: false } };
}

const pct = (locale: Locale, r: number | null): string => (r === null ? '—' : fmtPercent(locale, r, { minimumFractionDigits: 1 }));

/** The CSV of one report, as a small download button on the card's title line. */
function Csv({ by }: { by: string }) {
  return <ButtonLink href={`/api/admin/metrics?by=${by}`} download variant="ghost" size="sm"><IconDownload size={16} />CSV</ButtonLink>;
}

async function AccuracyTable({ dim, rows }: { dim: Dimension; rows: AccuracyRow[] }) {
  const { locale, ta } = await getI18n();
  const fmt = (n: number): string => fmtNumber(locale, n);
  return (
    <Table label={ta.metrics.dims[dim]} className={FLUSH_TABLE}>
      <thead>
        <tr>
          <Th>{ta.metrics.dims[dim]}</Th>
          <Th numeric>{ta.metrics.unchanged}</Th><Th numeric>{ta.metrics.replaced}</Th>
          <Th numeric>{ta.metrics.rejected}</Th><Th numeric>{ta.metrics.open}</Th>
          <Th numeric>{ta.metrics.rate}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="hover:bg-surface">
            <Td className="font-medium">{keyText(dim, r.key, locale)}</Td>
            <Td numeric>{fmt(r.unchanged)}</Td><Td numeric>{fmt(r.replaced)}</Td>
            <Td numeric>{fmt(r.rejected)}</Td><Td numeric>{fmt(r.open)}</Td>
            <Td numeric className="font-semibold">{pct(locale, r.rate)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Cross-org suggestion accuracy. Platform admins only; everyone else gets a 404. */
export default async function MetricsPage() {
  const { locale, t, ta } = await getI18n();
  const fmt = (n: number): string => fmtNumber(locale, n);
  const api = serverApi();
  const reports = await pageData(Promise.all(DIMENSIONS.map(async (d) => [d, await api.admin.accuracy({ by: d })] as const)));
  const tables = reports.map(([d, report]) => [d, report.rows] as const);
  // Every report carries the overall rate (of the stage table, as before) and the wrong reasons.
  const first = reports[0]?.[1];
  const total = first?.overall ?? { key: 'total', unchanged: 0, replaced: 0, rejected: 0, open: 0, decided: 0, rate: null };
  const reasons = first?.wrongReasons ?? [];

  return (
    <Page
      title={ta.metrics.title} hint={ta.metrics.hint} wide
      crumbs={[{ label: t.adminTitle, href: '/admin' }]}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label={ta.metrics.rate} value={pct(locale, total.rate)} tone="brand" />
          <Stat label={ta.metrics.decided} value={fmt(total.decided)} />
          <Stat label={ta.metrics.open} value={fmt(total.open)} />
        </div>

        {tables.map(([dim, rows]) => (
          <Card key={dim} title={ta.metrics.dims[dim]} flush={rows.length > 0} actions={<Csv by={dim} />}>
            {rows.length === 0 ? <EmptyState size="compact" as="h3" title={ta.metrics.noData} /> : <AccuracyTable dim={dim} rows={rows} />}
          </Card>
        ))}

        <Card title={ta.metrics.wrong} actions={<Csv by="reasons" />}>
          {reasons.length === 0 ? <EmptyState size="compact" as="h3" title={ta.metrics.noData} /> : (
            <ul className="divide-y divide-line">
              {reasons.map((r) => (
                <li key={r.reason} className="py-3 first:pt-0 last:pb-0">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{reasonText(r.reason, locale)}</span>
                    <span className="text-small tabular-nums text-muted">{fmt(r.count)}</span>
                  </p>
                  <ul className="mt-1.5 space-y-1 text-small text-muted">
                    {r.examples.map((e) => <li key={`${e.product}|${e.code}`}>{e.product}{e.code ? <>, <code className="font-mono text-mono">{e.code}</code></> : null}{e.note ? `: ${e.note}` : ''}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Page>
  );
}
