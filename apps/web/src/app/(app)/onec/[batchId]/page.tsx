// One import batch: its header and counts, the shared review grid, "Prepare for 1C", the export
// and the export history (docs/accounting-2026-10-23/onec-ui.md).
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { accounting } from '@tasnivo/contracts';
import { fmtDateTime, fmtNumber } from '@tasnivo/i18n/format';
import { signedIn } from '@/lib/api/me';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { canWrite } from '@/lib/pure/access';
import { StatusChip } from '@/ui/badge';
import { Page } from '@/ui/page';
import { StatRow, type StatRowItem } from '@/ui/stat-row';
import { Card } from '../../_manage/card';
import { BATCH_TONE, issueLabel } from '../review/columns';
import { ReviewGrid } from '../review/review-grid';
import { ExportPanel } from './export-panel';

type Props = { params: Promise<{ batchId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { t, ta } = await getI18n();
  const { batchId } = await params;
  return { title: `${ta.accountingX.nav.onec} · ${batchId.slice(-6)} — ${t.appName}` };
}

export default async function OnecBatchPage({ params }: Props) {
  const { locale, ta } = await getI18n();
  const user = await signedIn();
  if (!user) redirect('/sign-in');
  const { batchId } = await params;
  const data = await pageData(serverApi().onec.batch({ batchId, page: 0 }));
  const { batch } = data;
  const d = ta.onecX.detail;
  const a = ta.accountingX;
  const writer = canWrite(user) && !user.demo;
  const c = batch.counts;
  const n = (v: number): string => fmtNumber(locale, v);
  const items: StatRowItem[] = c ? [
    { key: 'total', label: d.counts, value: n(c.total) },
    { key: 'ready', label: a.record.valid, value: n(c.valid + c.corrected), tone: 'good' },
    { key: 'review', label: d.toReview, value: n(c.suspicious + c.unresolved), tone: c.unresolved > 0 ? 'danger' : c.suspicious > 0 ? 'warn' : 'neutral' },
    { key: 'exported', label: a.record.exported, value: n(c.exported) },
  ] : [];
  // Problems of the document itself (an invoice's seller), kept in its header by the producing workstream.
  const metaIssues = accounting.IncomingInvoiceMeta.shape.issues.safeParse((data.meta as { issues?: unknown } | null)?.issues);
  const docIssues = metaIssues.success ? metaIssues.data ?? [] : [];
  const title = batch.filename ?? batch.externalRef ?? a.kinds[batch.kind];

  return (
    <Page
      title={title} wide
      crumbs={[{ label: a.nav.onec, href: batch.clientId ? `/onec?client=${encodeURIComponent(batch.clientId)}` : '/onec' }]}
      actions={<StatusChip tone={BATCH_TONE[batch.status]}>{a.status[batch.status]}</StatusChip>}
    >
      <div className="space-y-6">
        <Card>
          <dl className="grid gap-x-6 gap-y-2 text-small sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-muted">{ta.onecX.list.colKind}</dt><dd className="font-medium">{a.kinds[batch.kind]}</dd></div>
            <div><dt className="text-muted">{d.client}</dt><dd className="font-medium">{batch.clientName ?? d.noClient}</dd></div>
            <div><dt className="text-muted">{d.source}</dt><dd className="font-medium">{batch.source}{batch.externalRef ? ` · ${batch.externalRef}` : ''}</dd></div>
            <div><dt className="text-muted">{d.created}</dt><dd className="font-medium">{fmtDateTime(locale, batch.createdAt)}</dd></div>
          </dl>
          {batch.error ? <p className="mt-3 text-small text-danger-ink">{batch.error}</p> : null}
          {docIssues.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={d.docIssues}>
              {docIssues.map((i, n) => (
                <li key={`${i.code}-${n}`}><StatusChip tone={i.severity === 'error' ? 'danger' : i.severity === 'warning' ? 'warn' : 'info'}>{issueLabel(ta, i.code)}</StatusChip></li>
              ))}
            </ul>
          ) : null}
        </Card>
        {items.length > 0 ? <StatRow items={items} label={d.counts} /> : null}
        <section aria-labelledby="review-title" className="space-y-3">
          <h2 id="review-title" className="text-section font-semibold">{d.review}</h2>
          <ReviewGrid batchId={batch.id} kind={batch.kind} readOnly={!writer} />
        </section>
        <ExportPanel initial={data} canWrite={writer} />
      </div>
    </Page>
  );
}
