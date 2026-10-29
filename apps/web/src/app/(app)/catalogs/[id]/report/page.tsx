import type { Metadata } from 'next';
import Link from 'next/link';
import { fmtDate, fmtNumber, fmtPercent } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { serverApi } from '@/lib/api/server';
import { typeLines } from '@/lib/catalogs/report';
import { catalogHeader, orNotFound, signedInUser } from '@/lib/catalogs/server';
import { getI18n } from '@/lib/locale';
import { groupDecisions } from '@/lib/pure/activity-groups';
import { Badge } from '@/ui/badge';
import { Button, ButtonLink } from '@/ui/button';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/empty-state';
import { IconDownload } from '@/ui/icons';
import { typeLabels, typeTone } from '@/ui/labels';
import { Page, Section } from '@/ui/page';
import { PrintButton } from '@/ui/print-button';
import { Progress } from '@/ui/progress';
import { Stat } from '@/ui/stat';
import { StatRow } from '@/ui/stat-row';
import { Table, Td, Th } from '@/ui/table';
import { ActivityFeed } from '../../../activity/activity-feed';
import { ClassifierBanner } from '../classifier-banner';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.importX.report.title} — ${t.appName}` };
}

const HISTORY = 12;

type Audience = 'internal' | 'client';

/** The client's latest 100 log rows (two API pages), as the page read them before. */
async function recentActivity(clientId: string) {
  const server = serverApi();
  const first = await server.account.activity({ client: clientId, category: 'all', page: 0 });
  if (!first.hasMore || first.rows.length >= 100) return first.rows;
  const second = await server.account.activity({ client: clientId, category: 'all', page: 1 });
  return [...first.rows, ...second.rows].slice(0, 100);
}

/** Internal or client-facing, as links: the choice is in the URL, so it survives a reload and prints as shown. */
function AudienceSwitch({ catalogId, audience, words }: { catalogId: string; audience: Audience; words: { audience: string; internal: string; client: string } }) {
  const item = (value: Audience, label: string) => {
    const active = value === audience;
    return (
      <Link
        href={value === 'client' ? `/catalogs/${catalogId}/report?for=client` : `/catalogs/${catalogId}/report`}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'inline-flex h-control-compact items-center rounded-sm px-3 text-small font-medium transition-colors duration-(--duration-fast)',
          active ? 'bg-brand-tint text-brand-ink inset-ring inset-ring-brand' : 'text-muted hover:bg-raised hover:text-fg',
        )}
      >
        {label}
      </Link>
    );
  };
  return (
    <nav aria-label={words.audience} className="no-print flex flex-wrap items-center gap-2">
      <span className="text-small text-muted">{words.audience}:</span>
      <span className="inline-flex gap-0.5 rounded-md bg-surface p-0.5 inset-ring inset-ring-line">
        {item('internal', words.internal)}
        {item('client', words.client)}
      </span>
    </nav>
  );
}

/**
 * The audit report of one finished catalogue review, from the same persisted data as the PDF: what was
 * checked, which issues were found, which are resolved and which are still open, how the catalogue
 * differs from its previous version, and what was done to it. Printable; the client-facing view leaves
 * out staff names and the internal history. Nothing here is a suggestion presented as a decision.
 */
export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ for?: string }> }) {
  const { locale, t, ta } = await getI18n();
  const r = ta.importX.report;
  const f = ta.importX.flow.report;
  await signedInUser();
  const { id } = await params;
  const audience: Audience = (await searchParams).for === 'client' ? 'client' : 'internal';
  const internal = audience === 'internal';
  const catalog = await orNotFound(catalogHeader(id));
  const crumbs = [{ label: t.navCatalogs, href: '/catalogs' }, { label: catalog.filename, href: `/catalogs/${catalog.id}` }];
  if (catalog.status !== 'ready') return <Page title={r.title} crumbs={crumbs}><EmptyState title={r.notReady} /></Page>;

  const server = serverApi();
  const [data, diff, history] = await Promise.all([
    orNotFound(server.catalogs.report({ catalogId: catalog.id })),
    // Only the counts are shown: one row of each list is enough.
    catalog.previousId ? orNotFound(server.catalogs.diff({ catalogId: catalog.id, limit: 1 })) : Promise.resolve(null),
    internal ? recentActivity(catalog.client.id) : Promise.resolve([]),
  ]);
  const n = (v: number): string => fmtNumber(locale, v);
  const pct = (ratio: number): string => fmtPercent(locale, ratio, { maximumFractionDigits: 0 });
  const labels = typeLabels(t);
  const lines = typeLines(data);
  const most = Math.max(1, ...lines.map((l) => l.findings));
  const own = history.filter((e) => e.catalogId === catalog.id).slice(0, HISTORY * 3).map((e) => ({ ...e, at: new Date(e.at) }));
  const byPeople = Math.max(0, data.counts.decided - data.counts.automatic);
  const reviewedRatio = data.riskyRows > 0 ? data.rowReview.done / data.riskyRows : 1;

  return (
    <Page
      title={r.title} hint={r.hint} wide crumbs={crumbs}
      actions={(
        <div className="no-print flex flex-wrap items-center gap-2">
          <PrintButton>{r.print}</PrintButton>
          {internal ? (
            <>
              <ButtonLink href={api.catalogs.exportPdf.url({ catalog: catalog.id, download: '1' })} variant="secondary" download><IconDownload size={16} />{r.pdf}</ButtonLink>
              <ButtonLink href={api.catalogs.exportReportCsv.url({ catalog: catalog.id })} variant="secondary" download>{r.csv}</ButtonLink>
            </>
          ) : catalog.exportLocked ? (
            // The client PDF waits for payment like the corrected file (D3), with the same reason.
            <>
              <Button variant="secondary" disabled aria-describedby="client-pdf-locked"><IconDownload size={16} />{r.pdfClient}</Button>
              <span id="client-pdf-locked" className="max-w-64 text-small text-muted">{ta.setX.billing.locked}</span>
            </>
          ) : (
            <ButtonLink href={api.catalogs.exportPdf.url({ catalog: catalog.id, audience: 'client', download: '1' })} variant="secondary" download><IconDownload size={16} />{r.pdfClient}</ButtonLink>
          )}
          <ButtonLink href={`/catalogs/${catalog.id}`} variant="primary">{r.openWorkspace}</ButtonLink>
        </div>
      )}
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <AudienceSwitch catalogId={catalog.id} audience={audience} words={f} />
        {internal ? null : <p className="text-small text-muted print:hidden">{f.clientNote}</p>}
        <p className="hidden text-small text-muted print:block">{internal ? f.internal : f.client}</p>
      </div>
      <ClassifierBanner className="mb-6" />

      <dl className="mb-8 grid gap-x-8 gap-y-3 rounded-lg border border-line bg-surface p-4 text-data sm:grid-cols-2 lg:grid-cols-4 print:border-line-strong print:bg-base">
        <div className="min-w-0"><dt className="text-small text-muted">{r.client}</dt><dd className="break-words font-medium">{data.clientName}</dd></div>
        <div className="min-w-0"><dt className="text-small text-muted">{r.file}</dt><dd className="break-words font-medium">{data.filename}</dd></div>
        <div><dt className="text-small text-muted">{r.audited}</dt><dd className="font-medium tabular-nums">{fmtDate(locale, catalog.createdAt)}</dd></div>
        <div><dt className="text-small text-muted">{r.classifier}</dt><dd className="font-medium tabular-nums">{data.classifierDate ? fmtDate(locale, data.classifierDate) : r.unknown}</dd></div>
      </dl>

      <Section title={r.summary}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
          <Stat label={r.rows} value={n(data.totalRows)} className="print:break-inside-avoid" />
          <Stat
            label={r.risky} value={n(data.riskyRows)} tone={data.riskyRows > 0 ? 'warn' : 'good'} className="print:break-inside-avoid"
            hint={data.totalRows > 0 ? f.ofRows(pct(data.riskyRows / data.totalRows)) : undefined}
          />
          <Stat
            label={r.reviewed} value={<>{n(data.rowReview.done)} <span className="text-section text-muted">/ {n(data.riskyRows)}</span></>} tone="good"
            hint={`${r.partly}: ${n(data.rowReview.partial)}`} className="print:break-inside-avoid"
          />
          <Stat label={r.open} value={n(data.rowReview.open)} tone={data.rowReview.open > 0 ? 'danger' : 'good'} className="print:break-inside-avoid" />
        </div>
        <div className="mt-4 rounded-lg border border-line bg-raised p-4 print:break-inside-avoid">
          <Progress label={f.progress} value={data.rowReview.done} max={Math.max(data.riskyRows, 1)} valueText={f.reviewedShare(pct(reviewedRatio))} tone="good" />
          <dl className="mt-4 grid gap-x-8 gap-y-2 text-data sm:grid-cols-3">
            <div><dt className="text-small text-muted">{r.detected}</dt><dd className="font-medium tabular-nums">{n(data.counts.detected)}</dd></div>
            <div>
              <dt className="text-small text-muted">{r.decided}</dt>
              <dd className="font-medium tabular-nums">
                {n(data.counts.decided)}
                {internal ? <span className="block text-small font-normal text-muted">{r.byPeople}: {n(byPeople)}; {r.automatic}: {n(data.counts.automatic)}</span> : null}
              </dd>
            </div>
            <div><dt className="text-small text-muted">{r.unresolved}</dt><dd className={cx('font-medium tabular-nums', data.counts.unresolved > 0 && 'text-danger-ink')}>{n(data.counts.unresolved)}</dd></div>
          </dl>
        </div>
      </Section>

      <Section title={r.issues}>
        {lines.length === 0 ? <p className="text-small text-muted">{ta.firmX.home.typesNone}</p> : (
          <Table label={r.issues}>
            <thead><tr><Th>{r.type}</Th><Th numeric>{r.count}</Th><Th className="hidden w-1/4 sm:table-cell"><span className="sr-only">{r.count}</span></Th><Th numeric>{r.colOpen}</Th><Th numeric>{r.colAccepted}</Th><Th numeric>{r.colRejected}</Th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.type} className="print:break-inside-avoid">
                  <Td><Badge tone={typeTone(l.type, 'high')}>{labels[l.type] ?? l.type}</Badge></Td>
                  <Td numeric className="font-semibold">{n(l.findings)}</Td>
                  <Td className="hidden sm:table-cell">
                    <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-sunken">
                      <span className="block h-full rounded-full bg-brand print:bg-fg" style={{ width: `${Math.round((l.findings / most) * 100)}%` }} />
                    </span>
                  </Td>
                  <Td numeric className={l.open > 0 ? 'text-danger-ink' : 'text-muted'}>{n(l.open)}</Td>
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

      {internal ? (
        <Section title={r.history} actions={<Link href="/activity" className="no-print text-small font-medium text-brand-ink hover:underline">{r.allHistory}</Link>}>
          {own.length === 0
            ? <p className="text-small text-muted">{r.historyEmpty}</p>
            : <ActivityFeed entries={groupDecisions(own).slice(0, HISTORY)} showClient={false} />}
        </Section>
      ) : null}

      <p className="mt-8 border-t border-line pt-4 text-small text-muted">{r.generated(fmtDate(locale, data.generatedAt))}</p>
    </Page>
  );
}
