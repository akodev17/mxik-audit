import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accuracyBy, DIMENSIONS, keyText, overall, reasonText, wrongReasons, type AccuracyRow, type Dimension } from '@/lib/accuracy';
import { isPlatformAdmin } from '@/lib/admin';
import { fmtNumber, fmtPercent } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { Page, Section } from '@/ui/page';
import { Table, Td, Th } from '@/ui/table';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.metrics.title} — ${t.appName}`, robots: { index: false } };
}

const pct = (locale: Locale, r: number | null): string => (r === null ? '—' : fmtPercent(locale, r, { minimumFractionDigits: 1 }));

async function AccuracyTable({ dim, rows }: { dim: Dimension; rows: AccuracyRow[] }) {
  const { locale, ta } = await getI18n();
  const fmt = (n: number): string => fmtNumber(locale, n);
  return (
    <Table label={ta.metrics.dims[dim]}>
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
          <tr key={r.key}>
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
  const user = await currentUser();
  if (!user || !(await isPlatformAdmin(user.userId))) notFound();
  const [tables, reasons] = await Promise.all([Promise.all(DIMENSIONS.map(async (d) => [d, await accuracyBy(d)] as const)), wrongReasons()]);
  const total = overall(tables[0]?.[1] ?? []);

  return (
    <Page title={ta.metrics.title} hint={ta.metrics.hint} wide actions={<Link href="/admin" className="text-small font-medium text-brand-ink hover:underline">{t.adminTitle}</Link>}>
      <dl className="mb-6 flex flex-wrap gap-8">
        <div><dt className="text-small text-muted">{ta.metrics.rate}</dt><dd className="text-title tabular-nums">{pct(locale, total.rate)}</dd></div>
        <div><dt className="text-small text-muted">{ta.metrics.decided}</dt><dd className="text-title tabular-nums">{fmt(total.decided)}</dd></div>
        <div><dt className="text-small text-muted">{ta.metrics.open}</dt><dd className="text-title tabular-nums">{fmt(total.open)}</dd></div>
      </dl>
      {tables.map(([dim, rows]) => (
        <Section key={dim} title={ta.metrics.dims[dim]}>
          {rows.length === 0 ? <p className="text-small text-muted">{ta.metrics.noData}</p> : <AccuracyTable dim={dim} rows={rows} />}
          <a href={`/api/admin/metrics?by=${dim}`} className="mt-2 inline-block text-small font-medium text-brand-ink hover:underline">CSV</a>
        </Section>
      ))}
      <Section title={ta.metrics.wrong}>
        {reasons.length === 0 ? <p className="text-small text-muted">{ta.metrics.noData}</p> : (
          <div className="space-y-4">
            {reasons.map((r) => (
              <div key={r.reason} className="rounded-ctl border border-line p-4">
                <p className="font-medium">{reasonText(r.reason, locale)} <span className="text-muted">({fmt(r.count)})</span></p>
                <ul className="mt-2 space-y-1 text-small text-muted">
                  {r.examples.map((e) => <li key={`${e.product}|${e.code}`}>{e.product}{e.code ? `, ${e.code}` : ''}{e.note ? `: ${e.note}` : ''}</li>)}
                </ul>
              </div>
            ))}
          </div>
        )}
        <a href="/api/admin/metrics?by=reasons" className="mt-2 inline-block text-small font-medium text-brand-ink hover:underline">CSV</a>
      </Section>
    </Page>
  );
}
