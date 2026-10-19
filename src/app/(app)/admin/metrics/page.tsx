import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accuracyBy, DIMENSIONS, overall, wrongReasons, type AccuracyRow, type Dimension } from '@/lib/accuracy';
import { isPlatformAdmin } from '@/lib/admin';
import { currentUser } from '@/lib/session';
import { Page, Section } from '@/ui/page';
import { Table, Td, Th } from '@/ui/table';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.metrics.title} — ${t.appName}`, robots: { index: false } };
}

const fmt = (n: number): string => n.toLocaleString('uz-UZ');
const pct = (r: number | null): string => (r === null ? '—' : `${(r * 100).toFixed(1)}%`);

async function AccuracyTable({ dim, rows }: { dim: Dimension; rows: AccuracyRow[] }) {
  const { ta } = await getI18n();
  return (
    <Table>
      <thead>
        <tr>
          <Th>{ta.metrics.dims[dim]}</Th>
          <Th className="text-right">{ta.metrics.unchanged}</Th><Th className="text-right">{ta.metrics.replaced}</Th>
          <Th className="text-right">{ta.metrics.rejected}</Th><Th className="text-right">{ta.metrics.open}</Th>
          <Th className="text-right">{ta.metrics.rate}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <Td className="font-medium">{r.key}</Td>
            <Td className="text-right">{fmt(r.unchanged)}</Td><Td className="text-right">{fmt(r.replaced)}</Td>
            <Td className="text-right">{fmt(r.rejected)}</Td><Td className="text-right">{fmt(r.open)}</Td>
            <Td className="text-right font-bold">{pct(r.rate)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Cross-org suggestion accuracy. Platform admins only; everyone else gets a 404. */
export default async function MetricsPage() {
  const { t, ta } = await getI18n();
  const user = await currentUser();
  if (!user || !(await isPlatformAdmin(user.userId))) notFound();
  const [tables, reasons] = await Promise.all([Promise.all(DIMENSIONS.map(async (d) => [d, await accuracyBy(d)] as const)), wrongReasons()]);
  const total = overall(tables[0]?.[1] ?? []);

  return (
    <Page title={ta.metrics.title} hint={ta.metrics.hint} wide actions={<Link href="/admin" className="text-sm text-brand hover:underline">{t.adminTitle}</Link>}>
      <dl className="mb-6 flex flex-wrap gap-8">
        <div><dt className="text-xs text-muted">{ta.metrics.rate}</dt><dd className="text-3xl font-bold">{pct(total.rate)}</dd></div>
        <div><dt className="text-xs text-muted">{ta.metrics.decided}</dt><dd className="text-3xl font-bold">{fmt(total.decided)}</dd></div>
        <div><dt className="text-xs text-muted">{ta.metrics.open}</dt><dd className="text-3xl font-bold">{fmt(total.open)}</dd></div>
      </dl>
      {tables.map(([dim, rows]) => (
        <Section key={dim} title={ta.metrics.dims[dim]}>
          {rows.length === 0 ? <p className="text-sm text-muted">{ta.metrics.noData}</p> : <AccuracyTable dim={dim} rows={rows} />}
          <a href={`/api/admin/metrics?by=${dim}`} className="mt-2 inline-block text-sm text-brand hover:underline">CSV</a>
        </Section>
      ))}
      <Section title={ta.metrics.wrong}>
        {reasons.length === 0 ? <p className="text-sm text-muted">{ta.metrics.noData}</p> : (
          <div className="space-y-4">
            {reasons.map((r) => (
              <div key={r.reason} className="rounded-ctl border border-line p-4">
                <p className="font-medium">{ta.wrong.reasons[r.reason as keyof typeof ta.wrong.reasons] ?? r.reason} <span className="text-muted">({fmt(r.count)})</span></p>
                <ul className="mt-2 space-y-1 text-sm text-muted">
                  {r.examples.map((e) => <li key={`${e.product}|${e.code}`}>{e.product}{e.code ? `, ${e.code}` : ''}{e.note ? `: ${e.note}` : ''}</li>)}
                </ul>
              </div>
            ))}
          </div>
        )}
        <a href="/api/admin/metrics?by=reasons" className="mt-2 inline-block text-sm text-brand hover:underline">CSV</a>
      </Section>
    </Page>
  );
}
