// One bank statement: its header and balance check, the review grid of its lines (by status,
// searchable, paged), bulk approval, and the 1C panel (dry run, file, history, reconciliation).
import type { Metadata } from 'next';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { canWrite } from '@/lib/pure/access';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { Page } from '@/ui/page';
import { Card, Fact } from '../../_manage/card';
import { Notice } from '../../_manage/notice';
import { money, STATUS_TONE } from '../bank-pure';
import { ReviewGrid, REVIEW_FILTERS, type ReviewFilter } from '../review/review-grid';
import { ExportPanel } from './export-panel';
import { ProcessingPoller } from './processing';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.bankX.title} — ${t.appName}` };
}

type Params = { status?: string; page?: string; q?: string };

export default async function StatementPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<Params> }) {
  const { locale, ta } = await getI18n();
  const b = ta.bankX;
  const { batchId } = await params;
  const sp = await searchParams;
  const api = serverApi();
  const [user, { statement }, report] = await Promise.all([
    pageData(api.auth.me()),
    pageData(api.bank.statement({ batchId })),
    pageData(api.bank.reconcile({ batchId })),
  ]);
  const writable = canWrite(user) && !user.demo;
  const counts = statement.counts;
  const open = (counts?.unresolved ?? 0) + (counts?.suspicious ?? 0);
  const filter: ReviewFilter = REVIEW_FILTERS.find((f) => f === sp.status) ?? (open > 0 ? 'open' : 'all');
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const q = sp.q?.trim().slice(0, 100) ?? '';
  const ready = statement.status !== 'uploaded' && statement.status !== 'failed';
  const records = ready ? await pageData(api.bank.records({ batchId, status: filter, page, ...(q ? { q } : {}) })) : null;
  const tone = STATUS_TONE[statement.status] ?? 'neutral';
  const n = (v: number): string => fmtNumber(locale, v);
  const period = statement.periodFrom ? `${fmtDate(locale, statement.periodFrom)}${statement.periodTo && statement.periodTo !== statement.periodFrom ? ` — ${fmtDate(locale, statement.periodTo)}` : ''}` : '—';
  const balance = report.balanced === null ? { tone: 'info' as const, text: b.review.balanceUnknown } : report.balanced ? { tone: 'good' as const, text: b.review.balanceOk } : { tone: 'danger' as const, text: b.review.balanceOff(money(report.difference)) };

  return (
    <Page
      title={b.review.title(statement.filename ?? statement.id)} wide
      crumbs={[{ label: b.title, href: statement.clientId ? `/bank?client=${statement.clientId}` : '/bank' }]}
      actions={<ButtonLink href={`/bank/${batchId}/reconcile`} variant="secondary">{b.export.reconcile}</ButtonLink>}
    >
      <div className="space-y-6">
        <Card title={b.review.summary} actions={<StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{ta.accountingX.status[statement.status]}</StatusChip>}>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label={b.list.client}>{statement.clientName ?? b.list.ownBooks}</Fact>
            <Fact label={b.upload.bank}>{statement.bankName ?? '—'}</Fact>
            <Fact label={b.upload.account}><span className="font-mono">{statement.account ?? '—'}</span></Fact>
            <Fact label={b.upload.period}>{period}</Fact>
            <Fact label={b.upload.opening}>{money(statement.openingBalance)}</Fact>
            <Fact label={b.upload.closing}>{money(statement.closingBalance)}</Fact>
            <Fact label={b.review.lines}>{counts ? `${n(counts.total)} · ${ta.accountingX.record.unresolved}: ${n(counts.unresolved)} · ${ta.accountingX.record.suspicious}: ${n(counts.suspicious)}` : '—'}</Fact>
            <Fact label={b.review.balance}><span className={balance.tone === 'good' ? 'text-good-ink' : balance.tone === 'danger' ? 'font-semibold text-danger-ink' : 'text-muted'}>{balance.text}</span></Fact>
          </dl>
          {statement.formatName ? (
            <p className="mt-3 text-small text-muted">{statement.formatName}{statement.formatVerified ? '' : ` — ${b.upload.unverified}`}</p>
          ) : null}
        </Card>

        {statement.status === 'uploaded' ? <ProcessingPoller batchId={batchId} progress={statement.progress} /> : null}
        {statement.status === 'failed' ? <Notice tone="danger" title={b.review.failed}>{statement.error}</Notice> : null}

        {records ? (
          <>
            <ExportPanel batchId={batchId} writable={writable} approved={statement.approved} exports={statement.exports} />
            <ReviewGrid
              batchId={batchId} writable={writable} filter={filter} q={q} page={records.page} pageSize={records.pageSize} total={records.total}
              records={records.records} counts={counts} approved={statement.approved}
            />
          </>
        ) : null}
      </div>
    </Page>
  );
}
