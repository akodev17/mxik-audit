'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { fmtNumber } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { isNetworkFailure } from '@/lib/api-failure';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { Badge, StatusChip } from '@/ui/badge';
import { Button, ButtonLink } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { cx } from '@/ui/cx';
import { Progress } from '@/ui/progress';
import { Spinner } from '@/ui/spinner';
import { Stepper } from '@/ui/stepper';
import { Table, Td, Th } from '@/ui/table';
import { useToast } from '@/ui/toast';
import { fill, issueText, RECORD_TONE, STATUS_TONE, type RecordStatus } from '../labels';

const RECORD_FILTERS: readonly RecordStatus[] = ['unresolved', 'suspicious', 'valid', 'corrected', 'skipped'];

/** One catalogue import: the check's progress, then its records with decisions, "save to catalogue" and "prepare for 1C". */
export function BatchView({ batchId, stages }: { batchId: string; stages: readonly string[] }) {
  const { ta, locale } = useI18n();
  const x = ta.productsX;
  const w = x.importWizard;
  const toast = useToast();
  const duplicate = useSearchParams().get('duplicate') === '1';
  const [filter, setFilter] = useState<RecordStatus | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [handover, setHandover] = useState<string | null>(null);
  const view = useQuery({
    queryKey: ['products', 'import', batchId, filter, page],
    queryFn: ({ signal }) => api.products.importBatch({ batchId, page, ...(filter ? { status: filter } : {}) }, { signal }),
    // While the check runs, the progress is polled; afterwards the data only changes by our own actions.
    refetchInterval: (q) => (q.state.data?.batch.status === 'parsed' ? 1_500 : false),
  });
  const run = async (key: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(key);
    try {
      await fn();
    } catch (error) {
      toast(isNetworkFailure(error) ? x.toast.network : x.toast.failed, { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (view.isPending) return <><Stepper stages={stages} current={2} /><div className="grid place-items-center py-16"><Spinner /></div></>;
  if (view.isError || !view.data) return <><Stepper stages={stages} current={2} /><Alert tone="danger" className="mt-5">{x.toast.failed}</Alert></>;
  const { batch, records, total, pageSize } = view.data;
  const counts = batch.counts;
  const checking = batch.status === 'parsed';
  const saveable = (counts?.total ?? 0) - (counts?.skipped ?? 0);

  const decide = (recordId: string, action: 'accept_suggestion' | 'skip' | 'reopen') => run(`${action}:${recordId}`, async () => {
    const r = await api.products.importDecide({ batchId, recordId, action });
    if (!r.ok) toast(r.error, { tone: 'error' });
    await view.refetch();
  });
  const apply = () => run('apply', async () => {
    const r = await api.products.importApply({ batchId });
    if (!r.ok) { toast(r.error, { tone: 'error' }); return; }
    toast(fill(w.applied, { created: fmtNumber(locale, r.created), updated: fmtNumber(locale, r.updated) }), { tone: 'ok' });
    await view.refetch();
  });
  const prepare = () => run('export', async () => {
    const r = await api.products.importExport({ batchId });
    setHandover(r.ok ? fill(x.toast.exportReady, { n: fmtNumber(locale, r.records) }) : r.error);
  });

  return (
    <>
    <Stepper stages={stages} current={checking ? 2 : batch.status === 'approved' ? 4 : 3} />
    <div className="mt-5 space-y-4">
      {duplicate ? <Alert tone="info">{w.duplicate}</Alert> : null}
      <p className="text-small text-muted">{batch.filename}{batch.dropped > 0 ? ` · ${fill(w.skipNote, { n: batch.dropped })}` : ''}</p>
      {checking ? (
        <Progress label={x.drawer.checking} value={batch.progress.done} max={Math.max(1, batch.progress.total)} valueText={fill(w.progress, { done: fmtNumber(locale, batch.progress.done), total: fmtNumber(locale, batch.progress.total) })} />
      ) : null}
      {batch.status === 'failed' ? <Alert tone="danger">{fill(w.failed, { error: batch.error ?? '' })}</Alert> : null}

      {counts ? (
        <nav aria-label={x.filterLabel} className="flex flex-wrap items-center gap-2">
          {[null, ...RECORD_FILTERS].filter((f) => f === null || f === filter || (counts[f] ?? 0) > 0).map((f) => {
            const on = f === filter;
            return (
              <button
                key={f ?? 'all'} type="button" aria-pressed={on} onClick={() => { setFilter(f); setPage(0); }}
                className={cx('inline-flex h-7 items-center gap-1.5 rounded-full border pl-3 pr-1.5 text-small font-medium', on ? 'border-brand bg-brand-tint text-brand-ink' : 'border-line-strong bg-raised text-fg hover:bg-surface')}
              >
                {f ? ta.accountingX.record[f] : x.status.all}
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sunken px-1.5 text-micro tabular-nums text-muted">{fmtNumber(locale, f ? counts[f] : counts.total)}</span>
              </button>
            );
          })}
        </nav>
      ) : null}

      {!checking && batch.status !== 'failed' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={busy === 'apply'} disabled={busy !== null || saveable === 0} onClick={() => void apply()}>{fill(w.apply, { n: fmtNumber(locale, saveable) })}</Button>
          <Button variant="secondary" loading={busy === 'export'} disabled={busy !== null} onClick={() => void prepare()}>{w.export1c}</Button>
          {batch.status === 'approved' ? <ButtonLink variant="ghost" href="/products">{x.title}</ButtonLink> : null}
        </div>
      ) : null}
      {handover ? <Alert tone="info">{handover}</Alert> : null}

      {/* While the check runs the records are not decided yet: only the progress is shown. */}
      {!checking && records.length > 0 ? (
        <Table label={batch.filename ?? x.title} density="compact">
          <thead>
            <tr>
              <Th numeric className="w-12">#</Th>
              <Th>{x.columns.name}</Th>
              <Th>{x.columns.mxik}</Th>
              <Th>{x.columns.status}</Th>
              <Th className="hidden md:table-cell">{x.drawer.suggestion}</Th>
              <Th className="w-40" />
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const p = r.payload;
              const matched = r.match?.status === 'matched' ? r.match.chosen : null;
              return (
                <tr key={r.id} className="border-t border-line align-top">
                  <Td numeric className="text-muted">{r.rowIndex + 1}</Td>
                  <Td className="max-w-72">
                    <span className="block truncate font-medium" title={p.name}>{p.name}</span>
                    <span className="text-micro text-muted">{[p.unit, p.packageCode ? `${x.columns.package}: ${p.packageCode}` : null, p.onecRef].filter(Boolean).join(' · ')}</span>
                    {matched ? <span className="block text-micro text-brand-ink">{fill(w.existing, { name: matched.label })} — {matched.reason}</span> : null}
                  </Td>
                  <Td className="max-w-60">
                    {p.mxik ? <CodeChip code={p.mxik} /> : <span className="text-muted">—</span>}
                    {p.mxikName ? <span className="block truncate text-micro text-muted" title={p.mxikName}>{p.mxikName}</span> : null}
                  </Td>
                  <Td className="max-w-64">
                    <div className="flex flex-wrap gap-1">
                      <StatusChip tone={RECORD_TONE[r.status]}>{ta.accountingX.record[r.status]}</StatusChip>
                      {p.mxikStatus !== 'ok' && p.mxikStatus !== 'unchecked' ? <Badge tone={STATUS_TONE[p.mxikStatus]}>{x.status[p.mxikStatus]}</Badge> : null}
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {r.issues.filter((i) => i.severity !== 'info').map((i, n) => <li key={n} className="text-micro text-muted">{issueText(x.issues, i)}</li>)}
                    </ul>
                  </Td>
                  <Td className="hidden max-w-64 md:table-cell">
                    {p.mxikSuggestion ? (
                      <>
                        <CodeChip code={p.mxikSuggestion.id} /> <Badge tone="neutral">{Math.round(p.mxikSuggestion.confidence * 100)}%</Badge>
                        <span className="block truncate text-micro" title={p.mxikSuggestion.label}>{p.mxikSuggestion.label.replace(`${p.mxikSuggestion.id} · `, '')}</span>
                        {p.mxikSuggestion.reason ? <span className="line-clamp-2 text-micro text-muted" title={p.mxikSuggestion.reason}>{p.mxikSuggestion.reason}</span> : null}
                      </>
                    ) : <span className="text-muted">—</span>}
                  </Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      {p.mxikSuggestion && r.status !== 'skipped' ? (
                        <Button size="compact" variant="secondary" loading={busy === `accept_suggestion:${r.id}`} disabled={busy !== null} onClick={() => void decide(r.id, 'accept_suggestion')}>{x.actions.useSuggestion}</Button>
                      ) : null}
                      {r.status === 'skipped'
                        ? <Button size="compact" variant="ghost" disabled={busy !== null} onClick={() => void decide(r.id, 'reopen')}>{w.reopen}</Button>
                        : <Button size="compact" variant="ghost" disabled={busy !== null} onClick={() => void decide(r.id, 'skip')}>{w.skip}</Button>}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : checking ? null : <p className="text-small text-muted">{x.empty.filtered}</p>}
      {page > 0 || (page + 1) * pageSize < total ? (
        <nav aria-label={x.pager.label} className="flex justify-end gap-2">
          {page > 0 ? <Button size="sm" variant="ghost" onClick={() => setPage(page - 1)}>{x.pager.prev}</Button> : null}
          {(page + 1) * pageSize < total ? <Button size="sm" variant="secondary" onClick={() => setPage(page + 1)}>{x.pager.next}</Button> : null}
        </nav>
      ) : null}
      <p className="text-micro text-muted"><Link href="/products/import" className="underline">{w.another}</Link></p>
    </div>
    </>
  );
}
