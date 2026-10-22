import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Page, Section } from '@/ui/page';
import { Stat } from '@/ui/stat';
import { StatusIcon } from '@/ui/badge';
import { typeLabels } from '@/ui/labels';
import { isPlatformAdmin } from '@/lib/admin';
import { fmtDateTime, fmtNumber } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { pipelineStatus } from '@/lib/pipeline-status';
import { tractionMetrics } from '@/lib/traction';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.adminTitle} — ${t.appName}`, robots: { index: false } };
}

function Rows({ rows, locale }: { rows: [string, number][]; locale: Locale }) {
  return (
    <dl className="divide-y divide-line rounded-ctl border border-line bg-raised">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-2">
          <dt className="text-small text-muted">{label}</dt>
          <dd className="tabular-nums">{fmtNumber(locale, value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Cross-org traction numbers. Platform admins only (src/lib/admin.ts); everyone else gets a 404. */
export default async function AdminPage() {
  const { locale, t, ta } = await getI18n();
  const user = await currentUser();
  if (!user || !(await isPlatformAdmin(user.userId))) notFound();
  const [m, pipeline] = await Promise.all([tractionMetrics(), pipelineStatus()]);
  const fmt = (n: number): string => fmtNumber(locale, n);

  return (
    <Page title={t.adminTitle} hint={t.adminHint} wide actions={<Link href="/admin/metrics" className="text-small font-medium text-brand-ink hover:underline">{ta.metrics.title}</Link>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t.adminOrgs} value={fmt(m.orgs.customers)} hint={t.adminLast30(m.orgs.newLast30Days)} />
        <Stat label={t.adminCatalogs} value={fmt(m.catalogs.total)} hint={t.adminLast30(m.catalogs.last30Days)} />
        <Stat label={t.adminRowsAudited} value={fmt(m.rows.audited)} />
        <Stat label={t.adminRiskyRows} value={fmt(m.rows.risky)} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Section title={t.adminByType}>
          <Rows locale={locale} rows={Object.entries(m.findingsByType).map(([type, n]) => [typeLabels(t)[type] ?? type, n])} />
        </Section>
        <Section title={t.adminDecisions}>
          <Rows locale={locale} rows={[
            [t.adminAccepted, m.decisions.accepted],
            [t.adminEdited, m.decisions.edited],
            [t.adminRejected, m.decisions.rejected],
            [t.adminPending, m.decisions.pending],
            [t.adminBulk, m.decisions.bulkAcceptedRows],
            [t.adminUndone, m.decisions.undone],
          ]} />
        </Section>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t.adminReviewTime} value={t.adminReviewValue(m.review.medianSecondsPerRow)} hint={t.adminReviewNote(m.review.sampleIntervals)} />
        <Stat label={t.adminDemo} value={fmt(m.demo.sessions)} hint={t.adminLast30(m.demo.last30Days)} />
        <Stat label={t.adminLeads} value={fmt(m.leads.total)} hint={`${t.adminLeadsFiles(m.leads.withFile)}, ${t.adminLast30(m.leads.last30Days)}`} />
      </div>

      <Section title={t.adminPipeline}>
        <dl className="divide-y divide-line rounded-ctl border border-line bg-raised">
          {pipeline.map((line) => (
            <div key={line.label} className="flex items-baseline justify-between gap-4 px-4 py-2">
              <dt className="text-small text-muted">{line.label}</dt>
              <dd className={`flex items-center gap-1.5 text-small font-medium ${line.ok ? 'text-good-ink' : 'text-danger-ink'}`}>
                <StatusIcon tone={line.ok ? 'good' : 'danger'} />{line.value}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <p className="mt-6 text-micro text-muted">{t.adminGenerated}: {fmtDateTime(locale, m.generatedAt)}</p>
    </Page>
  );
}
