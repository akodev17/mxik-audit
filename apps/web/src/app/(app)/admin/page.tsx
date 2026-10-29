import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import { Page } from '@/ui/page';
import { Stat } from '@/ui/stat';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { typeLabels } from '@/ui/labels';
import { Table, Td } from '@/ui/table';
import { fmtDateTime, fmtNumber } from '@tasnivo/i18n/format';
import type { Locale } from '@tasnivo/i18n/i18n';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { Card, FLUSH_TABLE } from '../_manage/card';
import { adminAllowed, tractionOnce } from './allowed';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${(await adminAllowed()) ? t.adminTitle : ta.shellX.notFound.title} — ${t.appName}`, robots: { index: false } };
}

/** Counts by name as a two-column table in a flush card; the card title names the table. */
function CountCard({ title, rows, locale }: { title: string; rows: [string, number][]; locale: Locale }) {
  return (
    <Card title={title} flush>
      <Table label={title} className={FLUSH_TABLE}>
        <tbody>
          {rows.map(([name, value]) => (
            <tr key={name} className="hover:bg-surface">
              <Td className="text-muted">{name}</Td>
              <Td numeric className="font-medium">{fmtNumber(locale, value)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

/** Cross-org traction numbers. Platform admins only; everyone else gets a 404 (the API's, via pageData). */
export default async function AdminPage() {
  const { locale, t, ta } = await getI18n();
  const api = serverApi();
  const [m, pipeline] = await pageData(Promise.all([tractionOnce(), api.admin.pipeline()]));
  const fmt = (n: number): string => fmtNumber(locale, n);

  return (
    <Page
      title={t.adminTitle} hint={t.adminHint} wide
      actions={<><ButtonLink href="/admin/billing" variant="secondary">{ta.setX.adminBilling.title}</ButtonLink><ButtonLink href="/admin/lexicon" variant="secondary">{ta.lexiconX.title}</ButtonLink><ButtonLink href="/admin/metrics" variant="secondary">{ta.metrics.title}</ButtonLink></>}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t.adminOrgs} value={fmt(m.orgs.customers)} hint={t.adminLast30(m.orgs.newLast30Days)} />
          <Stat label={t.adminCatalogs} value={fmt(m.catalogs.total)} hint={t.adminLast30(m.catalogs.last30Days)} />
          <Stat label={t.adminRowsAudited} value={fmt(m.rows.audited)} />
          <Stat label={t.adminRiskyRows} value={fmt(m.rows.risky)} tone={m.rows.risky > 0 ? 'danger' : 'neutral'} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label={t.adminReviewTime} value={t.adminReviewValue(m.review.medianSecondsPerRow)} hint={t.adminReviewNote(m.review.sampleIntervals)} />
          <Stat label={t.adminDemo} value={fmt(m.demo.sessions)} hint={t.adminLast30(m.demo.last30Days)} />
          <Stat label={t.adminLeads} value={fmt(m.leads.total)} hint={`${t.adminLeadsFiles(m.leads.withFile)}, ${t.adminLast30(m.leads.last30Days)}`} />
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <CountCard title={t.adminByType} locale={locale} rows={Object.entries(m.findingsByType).map(([type, n]) => [typeLabels(t)[type] ?? type, n])} />
          <CountCard title={t.adminDecisions} locale={locale} rows={[
            [t.adminAccepted, m.decisions.accepted],
            [t.adminEdited, m.decisions.edited],
            [t.adminRejected, m.decisions.rejected],
            [t.adminPending, m.decisions.pending],
            [t.adminBulk, m.decisions.bulkAcceptedRows],
            [t.adminUndone, m.decisions.undone],
          ]} />
        </div>

        <Card title={t.adminPipeline} flush>
          <Table label={t.adminPipeline} className={FLUSH_TABLE}>
            <tbody>
              {pipeline.map((line) => {
                const tone = line.ok ? 'good' : 'danger';
                return (
                  <tr key={line.label} className="hover:bg-surface">
                    <Td className="text-muted">{line.label}</Td>
                    <Td className="text-right"><StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{line.value}</StatusChip></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>

        <p className="text-micro text-muted">{t.adminGenerated}: {fmtDateTime(locale, new Date(m.generatedAt))}</p>
      </div>
    </Page>
  );
}
