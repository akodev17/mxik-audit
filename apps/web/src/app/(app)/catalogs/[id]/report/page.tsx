import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { catalogScope } from '@tasnivo/domain/access';
import { activityPage } from '@tasnivo/domain/activity';
import { groupDecisions } from '@tasnivo/domain/activity-groups';
import { db } from '@tasnivo/db';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { reportPdfData } from '@tasnivo/domain/pdf/report-data';
import { typeLines } from '@tasnivo/domain/report-summary';
import { currentUser } from '@/lib/session';
import { versionDiff } from '@tasnivo/domain/versions';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { typeLabels } from '@/ui/labels';
import { Page, Section } from '@/ui/page';
import { PrintButton } from '@/ui/print-button';
import { StatRow } from '@/ui/stat-row';
import { Table, Td, Th } from '@/ui/table';
import { ActivityFeed } from '../../../activity/activity-feed';
import { ClassifierBanner } from '../classifier-banner';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.importX.report.title} — ${t.appName}` };
}

const HISTORY = 12;

/**
 * The audit report of one finished catalogue review, from the same persisted data as the PDF: what was
 * checked, which issues were found, which are resolved and which are still open, how the catalogue
 * differs from its previous version, and what was done to it. Printable; nothing here is a suggestion
 * presented as a decision.
 */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { locale, t, ta } = await getI18n();
  const r = ta.importX.report;
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { id } = await params;
  const catalog = await db.catalog.findFirst({
    where: { id, ...catalogScope(user) },
    select: { id: true, filename: true, status: true, clientId: true, previousId: true, createdAt: true },
  });
  if (!catalog) notFound();
  const crumbs = [{ label: t.navCatalogs, href: '/catalogs' }, { label: catalog.filename, href: `/catalogs/${catalog.id}` }];
  if (catalog.status !== 'ready') return <Page title={r.title} crumbs={crumbs}><EmptyState title={r.notReady} /></Page>;

  const [data, diff, history] = await Promise.all([
    reportPdfData(user.orgId, catalog.id),
    catalog.previousId ? versionDiff(user.orgId, catalog.id, undefined, { limit: 0 }) : Promise.resolve(null),
    activityPage(user, { clientId: catalog.clientId, userId: null, category: 'all', from: null, to: null, page: 0 }, { pageSize: 100 }),
  ]);
  if (!data) notFound();
  const n = (v: number): string => fmtNumber(locale, v);
  const labels = typeLabels(t);
  const lines = typeLines(data);
  const own = history.rows.filter((e) => e.catalogId === catalog.id).slice(0, HISTORY * 3);
  const byPeople = Math.max(0, data.counts.decided - data.counts.automatic);

  return (
    <Page
      title={r.title} hint={r.hint} wide crumbs={crumbs}
      actions={(
        <div className="no-print flex flex-wrap items-center gap-2">
          <PrintButton>{r.print}</PrintButton>
          <ButtonLink href={`/api/report-pdf?catalog=${catalog.id}&download=1`} variant="secondary" download>{r.pdf}</ButtonLink>
          <ButtonLink href={`/api/report-pdf?catalog=${catalog.id}&audience=client&download=1`} variant="secondary" download>{r.pdfClient}</ButtonLink>
          <ButtonLink href={`/api/catalog-report-csv?catalog=${catalog.id}`} variant="secondary" download>{r.csv}</ButtonLink>
          <ButtonLink href={`/catalogs/${catalog.id}`} variant="primary">{r.openWorkspace}</ButtonLink>
        </div>
      )}
    >
      <ClassifierBanner className="mb-6" />
      <dl className="mb-8 grid gap-x-8 gap-y-3 text-data sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-small text-muted">{r.client}</dt><dd className="font-medium">{data.clientName}</dd></div>
        <div><dt className="text-small text-muted">{r.file}</dt><dd className="break-words font-medium">{data.filename}</dd></div>
        <div><dt className="text-small text-muted">{r.audited}</dt><dd className="font-medium">{fmtDate(locale, catalog.createdAt)}</dd></div>
        <div><dt className="text-small text-muted">{r.classifier}</dt><dd className="font-medium">{data.classifierDate ? fmtDate(locale, data.classifierDate) : r.unknown}</dd></div>
      </dl>

      <Section title={r.summary}>
        <StatRow
          label={r.summary}
          items={[
            { key: 'rows', label: r.rows, value: n(data.totalRows) },
            { key: 'risky', label: r.risky, value: n(data.riskyRows), tone: data.riskyRows > 0 ? 'warn' : 'good' },
            { key: 'done', label: r.reviewed, value: n(data.rowReview.done), unit: `/ ${n(data.riskyRows)}`, hint: `${r.partly}: ${n(data.rowReview.partial)}`, tone: 'good' },
            { key: 'open', label: r.open, value: n(data.rowReview.open), tone: data.rowReview.open > 0 ? 'danger' : 'good' },
          ]}
        />
        <dl className="mt-4 grid gap-x-8 gap-y-2 text-data sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-small text-muted">{r.detected}</dt><dd className="font-medium tabular-nums">{n(data.counts.detected)}</dd></div>
          <div>
            <dt className="text-small text-muted">{r.decided}</dt>
            <dd className="font-medium tabular-nums">
              {n(data.counts.decided)} <span className="font-normal text-muted">({r.byPeople}: {n(byPeople)}; {r.automatic}: {n(data.counts.automatic)})</span>
            </dd>
          </div>
          <div><dt className="text-small text-muted">{r.unresolved}</dt><dd className="font-medium tabular-nums">{n(data.counts.unresolved)}</dd></div>
        </dl>
      </Section>

      <Section title={r.issues}>
        {lines.length === 0 ? <p className="text-small text-muted">{ta.firmX.home.typesNone}</p> : (
          <Table label={r.issues}>
            <thead><tr><Th>{r.type}</Th><Th numeric>{r.count}</Th><Th numeric>{r.colOpen}</Th><Th numeric>{r.colAccepted}</Th><Th numeric>{r.colRejected}</Th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.type}>
                  <Td className="font-medium">{labels[l.type] ?? l.type}</Td>
                  <Td numeric>{n(l.findings)}</Td>
                  <Td numeric>{n(l.open)}</Td>
                  <Td numeric>{n(l.accepted)}</Td>
                  <Td numeric>{n(l.rejected)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {data.truncated ? <p className="mt-2 text-small text-muted">{r.truncated(n(data.rows.length))}</p> : null}
      </Section>

      <Section
        title={r.changes}
        actions={diff ? <Link href={`/catalogs/${catalog.id}/diff`} className="no-print text-small font-medium text-brand-ink hover:underline">{r.fullDiff}</Link> : null}
      >
        {diff ? (
          <StatRow
            label={r.changes}
            items={[
              { key: 'added', label: ta.diff.added, value: n(diff.counts.added) },
              { key: 'removed', label: ta.diff.removed, value: n(diff.counts.removed) },
              { key: 'changed', label: ta.diff.changed, value: n(diff.counts.changed) },
              { key: 'rereview', label: ta.importX.diff.reReview, value: n(diff.counts.reReview), tone: diff.counts.reReview > 0 ? 'warn' : 'neutral', hint: `${r.previous}: ${diff.previous.filename}` },
            ]}
          />
        ) : <p className="text-small text-muted">{r.noPrevious}</p>}
      </Section>

      <Section title={r.history} actions={<Link href="/activity" className="no-print text-small font-medium text-brand-ink hover:underline">{r.allHistory}</Link>}>
        {own.length === 0
          ? <p className="text-small text-muted">{r.historyEmpty}</p>
          : <ActivityFeed entries={groupDecisions(own).slice(0, HISTORY)} showClient={false} />}
      </Section>

      <p className="mt-8 text-small text-muted">{r.generated(fmtDate(locale, data.generatedAt))}</p>
    </Page>
  );
}
