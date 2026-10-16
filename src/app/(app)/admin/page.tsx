import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Page, Section } from '@/ui/page';
import { TYPE_LABEL } from '@/ui/labels';
import { isAdmin } from '@/lib/admin';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { pipelineStatus } from '@/lib/pipeline-status';
import { tractionMetrics } from '@/lib/traction';

export const metadata: Metadata = { title: `${t.adminTitle} — ${t.appName}`, robots: { index: false } };

const fmt = (n: number): string => n.toLocaleString('uz-UZ');

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-ctl border border-line px-4 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-3xl font-bold">{value}</dd>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
    </div>
  );
}

function Rows({ rows }: { rows: [string, number][] }) {
  return (
    <dl className="divide-y divide-line rounded-ctl border border-line">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-2">
          <dt className="text-sm text-muted">{label}</dt>
          <dd>{fmt(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Cross-org traction numbers. Only ADMIN_EMAILS may see it; everyone else gets a 404. */
export default async function AdminPage() {
  const user = await currentUser();
  if (!user || !isAdmin(user.email)) notFound();
  const [m, pipeline] = await Promise.all([tractionMetrics(), pipelineStatus()]);

  return (
    <Page title={t.adminTitle} hint={t.adminHint} wide>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t.adminOrgs} value={fmt(m.orgs.customers)} note={t.adminLast30(m.orgs.newLast30Days)} />
        <Stat label={t.adminCatalogs} value={fmt(m.catalogs.total)} note={t.adminLast30(m.catalogs.last30Days)} />
        <Stat label={t.adminRowsAudited} value={fmt(m.rows.audited)} />
        <Stat label={t.adminRiskyRows} value={fmt(m.rows.risky)} />
      </dl>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Section title={t.adminByType}>
          <Rows rows={Object.entries(m.findingsByType).map(([type, n]) => [TYPE_LABEL[type] ?? type, n])} />
        </Section>
        <Section title={t.adminDecisions}>
          <Rows rows={[
            [t.adminAccepted, m.decisions.accepted],
            [t.adminEdited, m.decisions.edited],
            [t.adminRejected, m.decisions.rejected],
            [t.adminPending, m.decisions.pending],
            [t.adminBulk, m.decisions.bulkAcceptedRows],
            [t.adminUndone, m.decisions.undone],
          ]} />
        </Section>
      </div>

      <dl className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t.adminReviewTime} value={t.adminReviewValue(m.review.medianSecondsPerRow)} note={t.adminReviewNote(m.review.sampleIntervals)} />
        <Stat label={t.adminDemo} value={fmt(m.demo.sessions)} note={t.adminLast30(m.demo.last30Days)} />
        <Stat label={t.adminLeads} value={fmt(m.leads.total)} note={`${t.adminLeadsFiles(m.leads.withFile)}, ${t.adminLast30(m.leads.last30Days)}`} />
      </dl>

      <Section title={t.adminPipeline}>
        <dl className="divide-y divide-line rounded-ctl border border-line">
          {pipeline.map((line) => (
            <div key={line.label} className="flex items-baseline justify-between gap-4 px-4 py-2">
              <dt className="text-sm text-muted">{line.label}</dt>
              <dd className={`text-sm font-medium ${line.ok ? 'text-good' : 'text-danger'}`}>{line.value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <p className="mt-6 text-xs text-muted">{t.adminGenerated}: {m.generatedAt.toLocaleString('uz-UZ')}</p>
    </Page>
  );
}
