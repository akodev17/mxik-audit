'use client';

// The shared review grid of an import batch (docs/accounting-2026-10-23/onec-ui.md): records with
// their status chip, the issues explained, single and bulk decisions (approve, correct, skip,
// reopen), filtered by status and paged. The 1C page shows it, and the bank statement and Didox
// pages embed it with the same props: `<ReviewGrid batchId kind columns? readOnly? />`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import type { OutputOf } from '@tasnivo/api-client';
import { accounting, type endpoints } from '@tasnivo/contracts';
import { api } from '@/lib/api/browser';
import { queryKey } from '@/lib/api/query';
import { refusalText } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { StatusChip } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/empty-state';
import { IconButton } from '@/ui/icon-button';
import { IconCheck, IconChevronDown, IconX } from '@/ui/icons';
import { Field, Input } from '@/ui/input';
import { Spinner } from '@/ui/spinner';
import { Table, Td, Th } from '@/ui/table';
import { useToast } from '@/ui/toast';
import {
  cellText, columnLabel, DEFAULT_COLUMNS, issueDetail, issueLabel, RECORD_TONE, scalarText, valueAt, type ImportKind, type RecordStatus, type ReviewColumn,
} from './columns';

type Detail = OutputOf<typeof endpoints.onec.batch>;
type Row = Detail['records'][number];
type Action = 'approve' | 'skip' | 'reopen';

export type ReviewGridProps = {
  batchId: string;
  kind: ImportKind;
  /** The columns to show; DEFAULT_COLUMNS[kind] when omitted. */
  columns?: ReviewColumn[];
  /** No decisions (a viewer, or a page that only shows the result). */
  readOnly?: boolean;
};

const chip = (active: boolean): string => cx(
  'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-small font-medium transition-colors duration-(--duration-fast)',
  active ? 'border-transparent bg-fg text-inverse' : 'border-line bg-raised text-muted hover:border-line-strong hover:text-fg',
);

/** The correction form of one record: its editable columns, prefilled; blank = null. */
function CorrectionForm({ row, columns, onDone }: { row: Row; columns: ReviewColumn[]; onDone: () => void }) {
  const { ta } = useI18n();
  const g = ta.onecX.grid;
  const toast = useToast();
  const queryClient = useQueryClient();
  const editable = columns.filter((c) => c.editable);
  const initial = useMemo(() => Object.fromEntries(editable.map((c) => {
    return [c.key, scalarText(valueAt(row.payload, c.key))];
  })), [editable, row.payload]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const corrections = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== initial[k]).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]));
      if (Object.keys(corrections).length === 0) return { ok: false as const, error: g.noChange };
      return api.onec.decide({ recordId: row.id, action: 'correct', corrections, ...(note.trim() ? { note: note.trim() } : {}) });
    },
    onSuccess: async (res) => {
      if (!res.ok) {
        setError('field' in res && res.field ? `${res.error} (${res.field})` : res.error);
        return;
      }
      toast(g.saved);
      await queryClient.invalidateQueries({ queryKey: queryKey(api.onec.batch) });
      onDone();
    },
    onError: (e) => setError(refusalText(e, ta.onecX.errors['generic'] ?? '')),
  });
  if (editable.length === 0) return null;
  return (
    <form
      className="mt-3 space-y-3 rounded-lg border border-line bg-surface p-3"
      onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}
      aria-label={g.corrections}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {editable.map((c) => (
          <Field key={c.key} label={columnLabel(c, ta.onecX.columns)}>
            <Input size="compact" value={values[c.key] ?? ''} onChange={(e) => setValues({ ...values, [c.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      <Field label={g.note}>
        <Input size="compact" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" loading={save.isPending}>{g.save}</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>{g.cancel}</Button>
      </div>
    </form>
  );
}

/** What the row's issues, decision and 1C outcome say, under the row. */
function RowDetails({ row, columns, readOnly, onDecide }: { row: Row; columns: ReviewColumn[]; readOnly: boolean; onDecide: (a: Action) => void }) {
  const { ta } = useI18n();
  const g = ta.onecX.grid;
  const a = ta.accountingX;
  const [correcting, setCorrecting] = useState(false);
  return (
    <div className="space-y-2 py-1 text-small">
      {row.issues.length > 0 ? (
        <ul className="space-y-1">
          {row.issues.map((issue, i) => (
            <li key={`${issue.code}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
              <StatusChip tone={issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warn' : 'info'}>{issueLabel(ta, issue.code)}</StatusChip>
              {issue.field ? <code className="font-mono text-mono text-muted">{issue.field}</code> : null}
              {issueDetail(issue.params) ? <span className="text-muted">{issueDetail(issue.params)}</span> : null}
              {issue.suggestion ? <span>{g.suggestion}: <strong>{issue.suggestion}</strong></span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {row.decision ? (
        <p className="text-muted">
          {g.decision}: {g.actions[row.decision.action] ?? row.decision.action}
          {row.decision.note ? ` — ${row.decision.note}` : ''}
        </p>
      ) : null}
      {row.outcome ? (
        <p className={row.outcome.result === 'rejected' ? 'text-danger-ink' : 'text-muted'}>
          1C: {a.outcome[row.outcome.result]}
          {row.outcome.reason ? ` — ${a.reasons[row.outcome.reason] ?? row.outcome.reason}` : ''}
          {row.outcome.message ? ` — ${row.outcome.message}` : ''}
          {row.outcome.onecRef ? ` (${row.outcome.onecRef})` : ''}
        </p>
      ) : null}
      {!readOnly && row.status !== 'exported' ? (
        correcting
          ? <CorrectionForm row={row} columns={columns} onDone={() => setCorrecting(false)} />
          : (
            <div className="flex flex-wrap gap-2">
              {columns.some((c) => c.editable) ? <Button size="sm" onClick={() => setCorrecting(true)}>{g.correct}</Button> : null}
              {row.status !== 'skipped' ? <Button size="sm" variant="ghost" onClick={() => onDecide('skip')}>{g.skip}</Button> : null}
              {row.status === 'skipped' || row.decision ? <Button size="sm" variant="ghost" onClick={() => onDecide('reopen')}>{g.reopen}</Button> : null}
            </div>
          )
      ) : null}
    </div>
  );
}

export function ReviewGrid({ batchId, kind, columns: given, readOnly = false }: ReviewGridProps) {
  const { locale, ta } = useI18n();
  const g = ta.onecX.grid;
  const a = ta.accountingX;
  const toast = useToast();
  const queryClient = useQueryClient();
  const all = given ?? DEFAULT_COLUMNS[kind];
  const columns = all.filter((c) => !c.formOnly);
  const [status, setStatus] = useState<RecordStatus | undefined>(undefined);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);

  const input = { batchId, page, ...(status ? { status } : {}) };
  const query = useQuery({ queryKey: queryKey(api.onec.batch, input), queryFn: ({ signal }) => api.onec.batch(input, { signal }), placeholderData: (prev) => prev });
  const data = query.data;

  const decide = useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: Action }) => {
      if (ids.length === 1) {
        const res = await api.onec.decide({ recordId: ids[0] ?? '', action });
        return res.ok ? { ok: true as const, count: 1, refused: 0 } : { ok: false as const, error: res.error };
      }
      const res = await api.onec.decideMany({ batchId, recordIds: ids, decision: { action } });
      return res.ok ? { ok: true as const, count: res.count, refused: res.refused.length } : { ok: false as const, error: res.error };
    },
    onSuccess: async (res) => {
      if (!res.ok) toast(res.error, { tone: 'error' });
      else {
        toast(res.refused > 0 ? `${g.decided(res.count)}. ${g.refused(res.refused)}` : g.decided(res.count), res.refused > 0 ? { tone: 'error' } : undefined);
        setSelected(new Set());
      }
      await queryClient.invalidateQueries({ queryKey: queryKey(api.onec.batch) });
    },
    onError: (e) => toast(refusalText(e, ta.onecX.errors['generic'] ?? ''), { tone: 'error' }),
  });
  const run = (ids: string[], action: Action) => decide.mutate({ ids, action });

  if (query.isError && !data) return <Alert tone="danger">{g.failed}</Alert>;
  if (!data) return <div className="flex items-center gap-2 py-6 text-muted"><Spinner size={16} />{g.loading}</div>;

  const counts = data.batch.counts;
  const rows = data.records;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const pageIds = rows.filter((r) => r.status !== 'exported').map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const statusFilter = (s: RecordStatus | undefined) => { setStatus(s); setPage(0); setSelected(new Set()); };
  const span = columns.length + (readOnly ? 4 : 5);

  return (
    <div className="space-y-3">
      <nav aria-label={g.colStatus} className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={chip(status === undefined)} aria-pressed={status === undefined} onClick={() => statusFilter(undefined)}>
          {g.allStatuses}{counts ? <span className="tabular-nums opacity-70">{counts.total}</span> : null}
        </button>
        {accounting.RECORD_STATUSES.map((s) => (counts && counts[s] === 0 && status !== s ? null : (
          <button key={s} type="button" className={chip(status === s)} aria-pressed={status === s} onClick={() => statusFilter(s)}>
            {a.record[s]}{counts ? <span className="tabular-nums opacity-70">{counts[s]}</span> : null}
          </button>
        )))}
      </nav>

      {!readOnly && selected.size > 0 ? (
        <div role="toolbar" aria-label={g.selected(selected.size)} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
          <span className="text-small font-medium">{g.selected(selected.size)}</span>
          <Button size="sm" variant="primary" loading={decide.isPending} onClick={() => run([...selected], 'approve')}>{g.approve}</Button>
          <Button size="sm" loading={decide.isPending} onClick={() => run([...selected], 'skip')}>{g.skip}</Button>
          <Button size="sm" variant="ghost" loading={decide.isPending} onClick={() => run([...selected], 'reopen')}>{g.reopen}</Button>
        </div>
      ) : null}
      {readOnly ? <p className="text-small text-muted">{g.readOnly}</p> : null}

      {rows.length === 0 ? (
        <EmptyState size="compact" title={g.empty} />
      ) : (
        <div className={cx(query.isFetching && 'opacity-70 transition-opacity')}>
          <Table label={g.label} density="compact" stickyHeader maxHeight="70vh">
            <thead>
              <tr>
                {readOnly ? null : (
                  <Th className="w-8">
                    <Checkbox label={g.selectPage} hideLabel checked={allOnPage} indeterminate={!allOnPage && pageIds.some((id) => selected.has(id))}
                      onChange={() => setSelected(allOnPage ? new Set() : new Set([...selected, ...pageIds]))} />
                  </Th>
                )}
                <Th numeric className="w-12">{g.colRow}</Th>
                <Th>{g.colStatus}</Th>
                {columns.map((c, i) => (
                  <Th key={c.key} numeric={(c.kind === 'money' || c.kind === 'signed')} className={cx(c.wide && i > 2 && 'hidden xl:table-cell')}>{columnLabel(c, ta.onecX.columns)}</Th>
                ))}
                <Th>{g.colIssues}</Th>
                <Th className="w-24"><span className="sr-only">{g.details}</span></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expanded = open === row.id;
                const first = row.issues[0];
                return (
                  <Fragment key={row.id}>
                    <tr className={cx('align-top hover:bg-surface', selected.has(row.id) && 'bg-brand-tint/40')}>
                      {readOnly ? null : (
                        <Td>
                          {row.status === 'exported' ? null : <Checkbox label={g.select} hideLabel checked={selected.has(row.id)} onChange={() => toggle(row.id)} />}
                        </Td>
                      )}
                      <Td numeric className="text-muted">{row.rowIndex + 1}</Td>
                      <Td><StatusChip tone={RECORD_TONE[row.status]}>{a.record[row.status]}</StatusChip></Td>
                      {columns.map((c, i) => {
                        const text = cellText(c, row.payload, locale, ta.onecX.direction);
                        return (
                          <Td key={c.key} numeric={(c.kind === 'money' || c.kind === 'signed')} className={cx(
                            c.wide && i > 2 && 'hidden xl:table-cell', c.kind === 'code' && 'font-mono text-mono', c.kind === 'long' ? 'max-w-[22rem]' : 'whitespace-nowrap',
                          )}>
                            <span className={cx(c.kind === 'long' && 'line-clamp-2')} title={text}>{text || <span className="text-subtle">—</span>}</span>
                          </Td>
                        );
                      })}
                      <Td className="max-w-[13rem] text-small">
                        {first ? (
                          <span className={first.severity === 'error' ? 'text-danger-ink' : first.severity === 'warning' ? 'text-warn-ink' : 'text-muted'}>
                            {issueLabel(ta, first.code)}{row.issues.length > 1 ? ` +${row.issues.length - 1}` : ''}
                          </span>
                        ) : row.outcome ? <span className="text-muted">{a.outcome[row.outcome.result]}</span> : null}
                      </Td>
                      <Td>
                          <span className="flex justify-end gap-0.5">
                            {!readOnly && (row.status === 'suspicious' || (row.status === 'valid' && !row.decision)) ? (
                              <IconButton label={g.approve} icon={<IconCheck size={14} />} onClick={() => run([row.id], 'approve')} disabled={decide.isPending} />
                            ) : null}
                            {!readOnly && row.status !== 'exported' && row.status !== 'skipped' ? (
                              <IconButton label={g.skip} icon={<IconX size={14} />} onClick={() => run([row.id], 'skip')} disabled={decide.isPending} />
                            ) : null}
                            <IconButton label={g.details} aria-expanded={expanded} icon={<IconChevronDown size={14} className={cx('transition-transform', expanded && 'rotate-180')} />}
                              onClick={() => setOpen(expanded ? null : row.id)} />
                          </span>
                        </Td>
                    </tr>
                    {expanded ? (
                      <tr className="bg-surface/60">
                        <td colSpan={span} className="px-3 pb-3">
                          <RowDetails row={row} columns={all} readOnly={readOnly} onDecide={(action) => run([row.id], action)} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-end gap-2 text-small" aria-label={ta.onecX.list.page(page + 1, pages)}>
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>{ta.onecX.list.prev}</Button>
          <span className="tabular-nums text-muted">{ta.onecX.list.page(page + 1, pages)}</span>
          <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{ta.onecX.list.next}</Button>
        </nav>
      ) : null}
    </div>
  );
}
