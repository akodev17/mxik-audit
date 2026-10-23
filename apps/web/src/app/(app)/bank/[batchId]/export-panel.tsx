'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isApiError } from '@tasnivo/api-client';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { fmtDateTime } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { orRefused } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
import { IconDownload } from '@/ui/icons';
import { useToast } from '@/ui/toast';
import { Card } from '../../_manage/card';
import { Notice } from '../../_manage/notice';

type Prepared = Extract<ResponseOf<typeof endpoints.bank.prepare>, { ok: true }>;
type Exports = ResponseOf<typeof endpoints.bank.statement>['statement']['exports'];

function save(blob: Blob, name: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * "Prepare for 1C": the dry run of what the next export sends (approved lines not exported yet),
 * the statement's checks and the 1C interface's own answer; then the bank_exchange_1_02 file,
 * built by the 1C interface. Lines exported before are never sent again.
 */
export function ExportPanel({ batchId, writable, approved, exports }: { batchId: string; writable: boolean; approved: number; exports: Exports }) {
  const { locale, ta } = useI18n();
  const x = ta.bankX.export;
  const router = useRouter();
  const toast = useToast();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'prepare' | 'export' | null>(null);

  async function prepare(): Promise<void> {
    setBusy('prepare');
    setError(null);
    const result = await orRefused(api.bank.prepare({ batchId }), ta.bankX.errors.network);
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    setPrepared(result);
  }

  async function download(): Promise<void> {
    setBusy('export');
    setError(null);
    try {
      const file = await api.bank.export({ batchId });
      save(file.blob, file.filename ?? 'bank_exchange.txt');
      toast(x.downloaded);
      router.refresh();
    } catch (e) {
      setError(isApiError(e) && e.status > 0 ? e.message : ta.bankX.errors.network);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title={x.title} as="h2"
      actions={writable ? (
        <span className="flex flex-wrap gap-2">
          <Button onClick={() => void prepare()} loading={busy === 'prepare'}>{busy === 'prepare' ? x.preparing : x.prepare}</Button>
          <Button variant="primary" onClick={() => void download()} loading={busy === 'export'} disabled={approved === 0} leadingIcon={<IconDownload size={16} />}>{x.download}</Button>
        </span>
      ) : undefined}
    >
      <div className="space-y-3">
        <p className="text-data">{approved > 0 ? x.ready(approved) : x.nothing}</p>
        {prepared ? (
          <div className="space-y-2">
            {prepared.alreadyExported > 0 ? <p className="text-small text-muted">{x.alreadyExported(prepared.alreadyExported)}</p> : null}
            {prepared.waiting > 0 ? <p className="text-small text-muted">{x.waiting(prepared.waiting)}</p> : null}
            <ul className="space-y-1">
              {prepared.checks.map((c) => (
                <li key={c.code} className="flex items-start gap-2 text-data">
                  <StatusIcon tone={c.ok ? 'good' : 'warn'} />
                  <span>{(x.checks as Record<string, string>)[c.code] ?? c.code}{c.detail && !c.ok ? ` (${c.detail})` : ''}</span>
                </li>
              ))}
            </ul>
            {prepared.onec.ok ? (
              prepared.onec.issues.length > 0 ? (
                <Notice tone="warn" title={x.onecIssues}>
                  <ul className="list-disc pl-4">{prepared.onec.issues.slice(0, 10).map((i, k) => <li key={k}>{(ta.bankX.issues as Record<string, string>)[i.code] ?? (ta.accountingX.issues as Record<string, string>)[i.code] ?? i.code}</li>)}</ul>
                </Notice>
              ) : null
            ) : prepared.onec.error === 'not_implemented' ? <Notice tone="info">{x.onecUnavailable}</Notice> : prepared.onec.error === 'nothing_to_export' ? null : <Notice tone="warn">{prepared.onec.error}</Notice>}
          </div>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {exports.length > 0 ? (
          <div>
            <h3 className="mb-1 text-small font-semibold text-muted">{x.history}</h3>
            <ul className="space-y-1 text-small">
              {exports.map((e) => (
                <li key={e.id}>
                  {fmtDateTime(locale, e.createdAt)} · {e.format} · {ta.bankX.lineCount(e.recordCount)}
                  {e.filename ? <> · <a className="text-brand-ink underline" href={`/api/onec/exports/${e.id}/file`} download>{e.filename}</a></> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
