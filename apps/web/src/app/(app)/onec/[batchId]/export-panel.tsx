'use client';

// "Prepare for 1C" (a dry run with its checks and issues), the export (built on the server, then
// downloaded from the history), the direct transfer when the org has one, and the export history
// with each export's outcome and a retry of what 1C refused.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { fmtDateTime } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { queryKey, useSeededQuery } from '@/lib/api/query';
import { refusalText } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { Button, ButtonLink } from '@/ui/button';
import { IconDownload } from '@/ui/icons';
import { Select } from '@/ui/select';
import { Table, Td, Th } from '@/ui/table';
import { useToast } from '@/ui/toast';
import { Card, FLUSH_TABLE } from '../../_manage/card';
import { issueDetail, issueLabel } from '../review/columns';

type Detail = OutputOf<typeof endpoints.onec.batch>;
type Format = Detail['primary'];
type Prepared = Extract<OutputOf<typeof endpoints.onec.prepare>, { ok: true }>;

/** Issues grouped by code: how many, and the rows of the first few. */
function groupIssues(issues: Prepared['issues']): { code: string; severity: string; count: number; rows: number[]; detail: string }[] {
  const groups = new Map<string, { code: string; severity: string; count: number; rows: number[]; detail: string }>();
  for (const i of issues) {
    const key = `${i.severity}:${i.code}`;
    const g = groups.get(key) ?? { code: i.code, severity: i.severity, count: 0, rows: [], detail: '' };
    g.count += 1;
    const row = i.params?.['row'];
    if (typeof row === 'number' && g.rows.length < 12) g.rows.push(row);
    if (!g.detail && row === undefined) g.detail = issueDetail(i.params);
    groups.set(key, g);
  }
  const order = { error: 0, warning: 1, info: 2 } as Record<string, number>;
  return [...groups.values()].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
}

export function ExportPanel({ initial, canWrite }: { initial: Detail; canWrite: boolean }) {
  const { locale, ta } = useI18n();
  const d = ta.onecX.detail;
  const a = ta.accountingX;
  const toast = useToast();
  const queryClient = useQueryClient();
  const input = { batchId: initial.batch.id, page: 0 };
  const { data } = useSeededQuery(api.onec.batch, initial, input);
  const [format, setFormat] = useState<Format>(initial.primary);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const batchId = data.batch.id;
  const fail = (e: unknown) => setError(refusalText(e, ta.onecX.errors['generic'] ?? ''));
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKey(api.onec.batch) });

  const prepare = useMutation({
    mutationFn: () => api.onec.prepare({ batchId, format }),
    onMutate: () => { setError(null); setPrepared(null); },
    onSuccess: (res) => (res.ok ? setPrepared(res) : setError(res.error)),
    onError: fail,
  });
  const build = useMutation({
    mutationFn: () => api.onec.exportBatch({ batchId, format }),
    onMutate: () => setError(null),
    onSuccess: async (res) => {
      if (!res.ok) { setError(res.error); return; }
      toast(res.reused ? d.reused : d.built(String(res.records), res.records));
      // The file is stored with the export; the browser fetches it like any download.
      window.location.assign(api.onec.exportFile.url({ exportId: res.exportId }));
      setPrepared(null);
      await refresh();
    },
    onError: fail,
  });
  const transfer = useMutation({
    mutationFn: () => api.onec.transfer({ batchId, format: 'odata' }),
    onMutate: () => setError(null),
    onSuccess: async (res) => {
      if (!res.ok) { setError(res.error); return; }
      toast(d.transferred(res.outcome.imported, res.outcome.rejected), res.outcome.rejected > 0 ? { tone: 'error' } : undefined);
      await refresh();
    },
    onError: fail,
  });

  const groups = prepared ? groupIssues(prepared.issues) : [];
  const side = format !== data.primary;
  const lastRejected = data.batch.exports.find((e) => e.format === 'odata')?.outcome?.rejected ?? 0;

  return (
    <div className="space-y-6">
      <Card title={d.prepare} hint={d.prepareHint}>
        <div className="flex flex-wrap items-end gap-3">
          <Select label={d.format} size="compact" value={format} wrapperClassName="w-full sm:w-80"
            onChange={(e) => { setFormat(e.target.value as Format); setPrepared(null); }}>
            {data.formats.map((f) => <option key={f} value={f}>{ta.onecX.formats[f] ?? f}</option>)}
          </Select>
          <Button size="sm" loading={prepare.isPending} onClick={() => prepare.mutate()}>{prepare.isPending ? d.running : d.run}</Button>
          {canWrite ? (
            <Button size="sm" variant="primary" leadingIcon={<IconDownload size={14} />} loading={build.isPending} onClick={() => build.mutate()}>
              {build.isPending ? d.downloading : d.download}
            </Button>
          ) : null}
        </div>
        <p className="mt-2 text-small text-muted">{ta.onecX.formatHints[format]}{side ? ` ${d.sideFile}` : ''}</p>
        {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}

        {prepared ? (
          <div className="mt-4 space-y-4" aria-live="polite">
            <p className="font-medium">{d.wouldGo(String(prepared.records), prepared.records)}</p>
            <div>
              <h3 className="mb-1.5 text-small font-semibold text-muted">{d.checks}</h3>
              <ul className="space-y-1">
                {prepared.checks.map((c) => (
                  <li key={c.code} className="flex flex-wrap items-center gap-2 text-small">
                    <StatusIcon tone={c.ok ? 'good' : 'warn'} />
                    <span>{d.check[c.code] ?? c.code}</span>
                    {c.detail && c.code !== 'records' && c.code !== 'duplicates' && c.code !== 'review' ? <span className="font-mono text-mono text-muted">{c.detail}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1.5 text-small font-semibold text-muted">{d.issues}</h3>
              {groups.length === 0 ? <p className="text-small text-muted">{d.noIssues}</p> : (
                <ul className="space-y-1.5">
                  {groups.map((g) => (
                    <li key={`${g.severity}:${g.code}`} className="text-small">
                      <StatusChip tone={g.severity === 'error' ? 'danger' : g.severity === 'warning' ? 'warn' : 'info'}>{issueLabel(ta, g.code)}</StatusChip>
                      <span className="ml-2 tabular-nums">× {g.count}</span>
                      {g.rows.length > 0 ? <span className="ml-2 text-muted">{ta.onecX.grid.colRow} {g.rows.join(', ')}{g.count > g.rows.length ? '…' : ''}</span> : null}
                      {g.detail ? <span className="ml-2 text-muted">{g.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Card>

      {data.transferAvailable && canWrite ? (
        <Card title={d.transfer} hint={d.transferNote}>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={transfer.isPending} onClick={() => transfer.mutate()}>{transfer.isPending ? d.transferring : d.transfer}</Button>
            {lastRejected > 0 ? <Button size="sm" variant="ghost" loading={transfer.isPending} onClick={() => transfer.mutate()}>{d.retry}</Button> : null}
          </div>
        </Card>
      ) : null}

      <Card title={d.exports} flush={data.batch.exports.length > 0}>
        {data.batch.exports.length === 0 ? <p className="text-small text-muted">{d.exportsEmpty}</p> : (
          <Table label={d.exports} className={FLUSH_TABLE} density="compact">
            <thead>
              <tr>
                <Th>{d.colWhen}</Th>
                <Th>{d.colFormat}</Th>
                <Th>{d.colResult}</Th>
                <Th>{d.colFile}</Th>
              </tr>
            </thead>
            <tbody>
              {data.batch.exports.map((e) => {
                const o = e.outcome;
                const reasons = o ? Object.entries(o.reasons).map(([k, n]) => `${a.reasons[k] ?? k}: ${n}`).join(', ') : '';
                return (
                  <tr key={e.id} className="align-top hover:bg-surface">
                    <Td className="whitespace-nowrap text-small">{fmtDateTime(locale, e.createdAt)}</Td>
                    <Td className="text-small">{ta.onecX.formats[e.format] ?? e.format}</Td>
                    <Td className="text-small">
                      {o ? (
                        <span className="flex flex-wrap gap-1.5">
                          <StatusChip tone="good">{a.outcome.imported}: {o.imported}</StatusChip>
                          {o.skipped > 0 ? <StatusChip tone="neutral">{a.outcome.skipped}: {o.skipped}</StatusChip> : null}
                          {o.rejected > 0 ? <StatusChip tone="danger">{a.outcome.rejected}: {o.rejected}</StatusChip> : null}
                        </span>
                      ) : '—'}
                      {reasons ? <span className="mt-1 block text-muted">{reasons}</span> : null}
                    </Td>
                    <Td className="text-small">
                      {e.hasFile
                        ? <ButtonLink href={api.onec.exportFile.url({ exportId: e.id })} size="sm" variant="ghost" leadingIcon={<IconDownload size={14} />} download>{e.filename ?? d.fileDownload}</ButtonLink>
                        : <span className="text-muted">{d.noFile}</span>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
