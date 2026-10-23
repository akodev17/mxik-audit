'use client';

// A local review grid for bank lines. The programme's shared grid (Agent 1,
// apps/web/src/app/(app)/onec/review/review-grid.tsx) is not on this branch yet; at integration
// this one should give way to it (docs/accounting-2026-10-23/agent2-result.md).
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { BankOperation, BankRecordRow } from '@tasnivo/contracts/modules/bank';
import { BANK_OPERATIONS } from '@tasnivo/contracts/modules/bank';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { orRefused } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Badge, StatusChip, StatusIcon, type Tone } from '@/ui/badge';
import { Button, ButtonLink } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { Input } from '@/ui/input';
import { Segmented } from '@/ui/segmented';
import { Table, Td, Th } from '@/ui/table';
import { useToast } from '@/ui/toast';
import { Card } from '../../_manage/card';
import { decidedKind, money, RECORD_TONE } from '../bank-pure';
import { EditDrawer } from './edit-drawer';

export const REVIEW_FILTERS = ['open', 'valid', 'approved', 'unresolved', 'skipped', 'exported', 'all'] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

type Counts = { total: number; valid: number; corrected: number; suspicious: number; unresolved: number; skipped: number; exported: number } | null;

const SEVERITY_TONE: Record<string, Tone> = { error: 'danger', warning: 'warn', info: 'info' };
const isOperation = (v: string): v is BankOperation => (BANK_OPERATIONS as readonly string[]).includes(v);

type Props = {
  batchId: string; writable: boolean; filter: ReviewFilter; q: string; page: number; pageSize: number; total: number;
  records: BankRecordRow[]; counts: Counts; approved: number;
};

export function ReviewGrid({ batchId, writable, filter, q, page, pageSize, total, records, counts, approved }: Props) {
  const { locale, ta } = useI18n();
  const b = ta.bankX;
  const r = b.review;
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<BankRecordRow | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (next: { status?: ReviewFilter; page?: number; q?: string }): string => {
    const sp = new URLSearchParams();
    sp.set('status', next.status ?? filter);
    const query = next.q ?? q;
    if (query) sp.set('q', query);
    if ((next.page ?? 1) > 1) sp.set('page', String(next.page));
    return `${pathname}?${sp.toString()}`;
  };

  async function decide(record: BankRecordRow, body: Omit<Parameters<typeof api.bank.decide>[0], 'recordId'>, done?: string): Promise<boolean> {
    setBusy(record.id);
    const result = await orRefused(api.bank.decide({ recordId: record.id, ...body }), b.errors.network);
    setBusy(null);
    if (!result.ok) { toast(result.error, { tone: 'error' }); return false; }
    if (result.ruleId && result.applied >= 0) toast(b.edit.ruleSaved(result.applied));
    else if (done) toast(done);
    router.refresh();
    return true;
  }

  async function approveMany(scope: 'valid' | 'reviewable'): Promise<{ ok: true } | { ok: false; error: string }> {
    const result = await orRefused(api.bank.approve({ batchId, scope }), b.errors.network);
    if (!result.ok) return result;
    toast(result.approved > 0 ? r.approvedN(result.approved) : r.nothingToApprove);
    router.refresh();
    return { ok: true };
  }

  const issueText = (code: string, params: Record<string, string | number> | undefined): string => {
    if (code === 'duplicate_row') return params?.['source'] === 'file' ? b.issueDetail.duplicateFile(Number(params['row'])) : b.issueDetail.duplicateExported;
    const label = (b.issues as Record<string, string>)[code] ?? code;
    return params?.['value'] !== undefined ? `${label}. ${b.issueDetail.value(String(params['value']))}` : label;
  };

  const decidedLabel = (by: string | null): string | null => {
    const k = decidedKind(by);
    if (!k) return null;
    if (k.kind === 'builtin') return `${b.decidedBy.builtin}: ${(b.builtinRules as Record<string, string>)[k.name ?? ''] ?? k.name}`;
    return b.decidedBy[k.kind];
  };

  return (
    <Card title={b.review.lines} as="h2" flush>
      <div className="space-y-3 border-b border-line p-4">
        <Segmented
          label={b.review.lines} value={filter} size="compact" className="max-w-full overflow-x-auto"
          onChange={(status) => router.push(href({ status, page: 1 }))}
          options={REVIEW_FILTERS.map((f) => ({ value: f, label: r.filters[f] }))}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <form action={pathname} className="flex gap-2 sm:w-96">
            <input type="hidden" name="status" value={filter} />
            <Input name="q" defaultValue={q} placeholder={r.search} aria-label={r.search} />
            <Button type="submit" variant="secondary">{ta.firmX.filterBar.apply}</Button>
          </form>
          {writable ? (
            <span className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void approveMany('valid')}>{r.approveValid(counts?.valid ?? 0)}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmAll(true)}>{r.approveReviewable}</Button>
            </span>
          ) : null}
        </div>
      </div>

      {records.length === 0 ? (
        <p className="p-6 text-center text-data text-muted">{r.empty}</p>
      ) : (
        <Table label={b.review.lines} density="compact" className="rounded-none! border-0!" stickyHeader maxHeight="70vh">
          <thead>
            <tr>
              <Th numeric>{r.columns.row}</Th>
              <Th>{r.columns.date}</Th>
              <Th>{r.columns.counterparty}</Th>
              <Th>{r.columns.purpose}</Th>
              <Th numeric>{r.columns.debit}</Th>
              <Th numeric>{r.columns.credit}</Th>
              <Th>{r.columns.operation}</Th>
              <Th>{r.columns.status}</Th>
              <Th>{r.columns.issues}</Th>
              <Th><span className="sr-only">{r.columns.actions}</span></Th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec) => {
              const p = rec.payload;
              const exported = rec.status === 'exported';
              const isApproved = rec.decision?.action === 'approve';
              const hasError = rec.issues.some((i) => i.severity === 'error');
              const tone = RECORD_TONE[rec.status] ?? 'neutral';
              const shownIssues = rec.issues.filter((i) => i.code !== 'operation_suggested');
              const suggestion = p.operationSuggestion;
              const locked = !writable || exported;
              return (
                <tr key={rec.id} className="align-top hover:bg-surface">
                  <Td numeric className="text-subtle">{rec.rowIndex}</Td>
                  <Td className="whitespace-nowrap">
                    {p.date ? fmtDate(locale, p.date) : <span className="text-danger-ink">—</span>}
                    {p.docNumber ? <span className="block text-small text-muted">№ {p.docNumber}</span> : null}
                  </Td>
                  <Td className="max-w-56">
                    <span className="block truncate" title={p.counterparty.name}>{p.counterparty.name || '—'}</span>
                    {p.counterparty.inn ? <span className="block font-mono text-small text-muted">{p.counterparty.inn}</span> : null}
                  </Td>
                  <Td className="max-w-72"><span className="line-clamp-2 text-small" title={p.purpose}>{p.purpose || '—'}</span></Td>
                  <Td numeric className="whitespace-nowrap">{p.direction === 'debit' ? money(p.amount) : ''}</Td>
                  <Td numeric className="whitespace-nowrap">{p.direction === 'credit' ? money(p.amount) : ''}</Td>
                  <Td className="min-w-44">
                    {locked ? (
                      <span>{p.operation && isOperation(p.operation) ? b.operations[p.operation] : b.operations.none}</span>
                    ) : (
                      <select
                        aria-label={`${r.columns.operation} ${rec.rowIndex}`}
                        className="h-control-compact w-full rounded-sm border border-line-input bg-raised px-2 text-small"
                        value={p.operation ?? ''} disabled={busy === rec.id}
                        onChange={(e) => void decide(rec, { action: 'correct', corrections: { operation: e.target.value || null } }, b.edit.saved)}
                      >
                        <option value="">{b.operations.none}</option>
                        {BANK_OPERATIONS.map((o) => <option key={o} value={o}>{b.operations[o]}</option>)}
                      </select>
                    )}
                    {decidedLabel(p.decidedBy) ? <span className="mt-0.5 block text-micro text-muted">{decidedLabel(p.decidedBy)}</span> : null}
                    {suggestion && !p.operation && isOperation(suggestion.id) ? (
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        <Badge tone="info" title={suggestion.reason}>{r.suggestion(b.operations[suggestion.id], Math.round(suggestion.confidence * 100))}</Badge>
                        {!locked ? <Button size="compact" variant="ghost" onClick={() => void decide(rec, { action: 'correct', corrections: { operation: suggestion.id } }, b.edit.saved)}>{r.acceptSuggestion}</Button> : null}
                      </span>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{ta.accountingX.record[rec.status]}</StatusChip>
                    {isApproved && !exported ? <span className="mt-0.5 block text-micro text-good-ink">{r.approved}</span> : null}
                  </Td>
                  <Td className="max-w-64">
                    <span className="flex flex-wrap gap-1">
                      {shownIssues.map((i, k) => <Badge key={k} tone={SEVERITY_TONE[i.severity] ?? 'neutral'} title={issueText(i.code, i.params)}>{(b.issues as Record<string, string>)[i.code] ?? i.code}</Badge>)}
                    </span>
                  </Td>
                  <Td>
                    {exported ? <span className="text-micro text-muted" title={r.exportedLocked}>{r.exportedLocked}</span> : writable ? (
                      <span className="flex flex-nowrap justify-end gap-1">
                        {!isApproved && !hasError && rec.status !== 'skipped' ? <Button size="compact" variant="secondary" loading={busy === rec.id} onClick={() => void decide(rec, { action: 'approve' })}>{r.approve}</Button> : null}
                        <Button size="compact" variant="ghost" onClick={() => setEditing(rec)}>{r.edit}</Button>
                        {rec.status === 'skipped' || isApproved ? (
                          <Button size="compact" variant="ghost" onClick={() => void decide(rec, { action: 'reopen' })}>{r.reopen}</Button>
                        ) : (
                          <Button size="compact" variant="ghost" onClick={() => void decide(rec, { action: 'skip' })}>{r.skip}</Button>
                        )}
                      </span>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-between gap-2 border-t border-line p-3 text-small">
          <span className="text-muted">{fmtNumber(locale, total)} · {r.page(page, pages)}</span>
          <span className="flex gap-2">
            {page > 1 ? <ButtonLink size="sm" href={href({ page: page - 1 })}>{r.prev}</ButtonLink> : null}
            {page < pages ? <ButtonLink size="sm" href={href({ page: page + 1 })}>{r.next}</ButtonLink> : null}
          </span>
        </div>
      ) : null}

      {editing ? <EditDrawer record={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} /> : null}
      <ConfirmDialog
        open={confirmAll} onClose={() => setConfirmAll(false)}
        title={r.approveReviewable} description={r.approveReviewableHint} count={Math.max(0, (counts?.total ?? 0) - (counts?.unresolved ?? 0) - (counts?.skipped ?? 0) - (counts?.exported ?? 0) - approved)}
        countLabel={b.review.lines} confirmLabel={r.approve}
        onConfirm={() => approveMany('reviewable')}
      />
    </Card>
  );
}
