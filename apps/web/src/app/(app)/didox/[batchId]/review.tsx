'use client';

// The line review of one invoice. A local grid: Agent 1's shared review grid
// (apps/web/src/app/(app)/onec/review/) is not on this branch yet; at integration this table is
// replaced by it and keeps the picker dialog, the bulk buttons and the prepare panel.
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { fmtNumber } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { orRefused } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Badge, StatusChip, StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Dialog } from '@/ui/dialog';
import { Field, Input } from '@/ui/input';
import { Segmented } from '@/ui/segmented';
import { Table, Td, Th } from '@/ui/table';
import { useToast } from '@/ui/toast';
import { Card, FLUSH_TABLE } from '../../_manage/card';
import { Notice } from '../../_manage/notice';
import { decimalText, issueText, recordTone, severityTone } from '../model';

type Detail = ResponseOf<typeof endpoints.didox.get>;
type Line = Detail['records'][number];
type Prepared = Extract<ResponseOf<typeof endpoints.didox.prepare>, { ok: true }>;
type Decision = { action: 'approve' | 'correct' | 'skip' | 'reopen'; corrections?: { product?: string; mxik?: string } };

const MATCH_TONE = { matched: 'good', ambiguous: 'warn', new: 'info', unknown: 'neutral' } as const;

export function InvoiceReview({ detail, writable }: { detail: Detail; writable: boolean }) {
  const { locale, ta } = useI18n();
  const d = ta.didoxX;
  const g = d.detail.grid;
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'problems'>(detail.records.some((r) => r.status === 'unresolved' || r.status === 'suspicious') ? 'problems' : 'all');
  const [picking, setPicking] = useState<Line | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [preparing, startPrepare] = useTransition();
  const [exporting, setExporting] = useState<string | null>(null);

  const rows = filter === 'all' ? detail.records : detail.records.filter((r) => r.status === 'unresolved' || r.status === 'suspicious');
  const decided = (r: Line): boolean => r.decision !== null && r.decision !== undefined;

  const decide = async (line: Line, decision: Decision): Promise<boolean> => {
    setBusy(line.id);
    setError(null);
    const res = await orRefused(api.didox.decide({ recordId: line.id, ...decision }), d.errors.generic);
    setBusy(null);
    if (!res.ok) { setError(res.error); return false; }
    setPrepared(null);
    router.refresh();
    return true;
  };

  const bulk = async (scope: 'matched' | 'clean'): Promise<void> => {
    setBusy(scope);
    setError(null);
    const res = await orRefused(api.didox.approveMany({ batchId: detail.invoice.id, scope }), d.errors.generic);
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    toast(d.detail.approvedN(res.approved));
    setPrepared(null);
    router.refresh();
  };

  const prepare = (): void => {
    setError(null);
    startPrepare(async () => {
      const res = await orRefused(api.didox.prepare({ batchId: detail.invoice.id }), d.errors.generic);
      if (!res.ok) { setError(res.error); return; }
      setPrepared(res);
    });
  };

  const download = async (format: 'receipt_xlsx' | 'nomenclature_xlsx'): Promise<void> => {
    setExporting(format);
    setError(null);
    const res = await orRefused(api.didox.exportFile({ batchId: detail.invoice.id, format }), d.errors.export_failed);
    setExporting(null);
    if ('ok' in res && !res.ok) { setError(res.error); return; }
    const file = res as { blob: Blob; filename: string | null };
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename ?? `${format}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    router.refresh();
  };

  const counts = detail.invoice.counts;
  const n = (v: number): string => fmtNumber(locale, v);

  return (
    <div className="space-y-4">
      <Card
        title={`${ta.didoxX.list.lines}: ${n(detail.records.length)}`}
        hint={counts ? (['valid', 'corrected', 'suspicious', 'unresolved', 'skipped'] as const).map((s) => `${ta.accountingX.record[s]}: ${n(counts[s])}`).join(' · ') : undefined}
        actions={(
          <Segmented
            label={g.status} value={filter} onChange={setFilter}
            options={[{ value: 'problems', label: d.detail.filterProblems }, { value: 'all', label: d.detail.filterAll }]}
          />
        )}
        flush
        footer={writable ? (
          <span className="flex flex-wrap justify-end gap-2">
            <Button size="sm" onClick={() => void bulk('matched')} loading={busy === 'matched'}>{d.detail.approveMatched}</Button>
            <Button size="sm" onClick={() => void bulk('clean')} loading={busy === 'clean'}>{d.detail.approveClean}</Button>
          </span>
        ) : undefined}
      >
        <Table label={d.title} className={FLUSH_TABLE} density="compact" stickyHeader maxHeight="36rem">
          <thead>
            <tr>
              <Th numeric>{g.line}</Th>
              <Th>{g.name}</Th>
              <Th className="hidden 2xl:table-cell">{g.mxik}</Th>
              <Th className="hidden lg:table-cell">{g.package}</Th>
              <Th numeric>{g.quantity}</Th>
              <Th numeric className="hidden 2xl:table-cell">{g.price}</Th>
              <Th numeric>{g.total}</Th>
              <Th className="hidden 2xl:table-cell">{g.product}</Th>
              <Th>{g.issues}</Th>
              <Th>{g.status}</Th>
              {writable ? <Th><span className="sr-only">{g.actions}</span></Th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><Td colSpan={11} className="py-6 text-center text-muted">{d.detail.noProblems}</Td></tr> : null}
            {rows.map((r) => {
              const p = r.payload;
              const tone = recordTone(r.status);
              const match = p.product.status;
              return (
                <tr key={r.id} className="align-top hover:bg-surface">
                  <Td numeric className="text-muted">{p.lineNo}</Td>
                  <Td className="min-w-48 max-w-sm">
                    <span className="block font-medium">{p.name}</span>
                    {r.sameAs.length > 0 ? <span className="block text-small text-muted">{d.detail.group(r.sameAs.join(', '))}</span> : null}
                    <span className="block font-mono text-small text-muted 2xl:hidden">{p.mxik ?? '—'}</span>
                    <span className="mt-1 block 2xl:hidden"><Badge tone={MATCH_TONE[match]}>{d.detail.match[match]}</Badge>{p.product.chosen ? <span className="ml-1 text-small text-muted">{p.product.chosen.label}</span> : null}</span>
                  </Td>
                  <Td className="hidden 2xl:table-cell">
                    <span className="block font-mono text-small">{p.mxik ?? '—'}</span>
                    {p.mxikName ? <span className="block max-w-56 truncate text-small text-muted" title={p.mxikName}>{p.mxikName}</span> : null}
                  </Td>
                  <Td className="hidden whitespace-nowrap lg:table-cell">{p.packageName ?? p.unit ?? '—'}</Td>
                  <Td numeric className="whitespace-nowrap">{decimalText(p.quantity)}</Td>
                  <Td numeric className="hidden whitespace-nowrap 2xl:table-cell">{decimalText(p.price, { money: true })}</Td>
                  <Td numeric className="whitespace-nowrap">{decimalText(p.total, { money: true })}</Td>
                  <Td className="hidden min-w-32 2xl:table-cell">
                    <Badge tone={MATCH_TONE[match]}>{d.detail.match[match]}</Badge>
                    {p.product.chosen ? <span className="mt-1 block max-w-48 truncate text-small text-muted" title={p.product.chosen.reason ?? p.product.chosen.label}>{p.product.chosen.label}</span> : null}
                  </Td>
                  <Td className="min-w-40">
                    <ul className="flex flex-wrap gap-1">
                      {r.issues.filter((i) => i.code !== 'product_unchecked').map((i, k) => (
                        <li key={`${i.code}-${k}`}><Badge tone={severityTone(i.severity)} title={issueTitle(i)}>{issueText(i.code, i.params, d.issues, ta.productsX.issues)}</Badge></li>
                      ))}
                    </ul>
                  </Td>
                  <Td><StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{ta.accountingX.record[r.status]}</StatusChip></Td>
                  {writable ? (
                    <Td>
                      <span className="flex flex-wrap justify-end gap-1">
                        {r.status === 'exported' ? null : decided(r) ? (
                          <Button size="compact" variant="ghost" onClick={() => void decide(r, { action: 'reopen' })} loading={busy === r.id}>{d.detail.reopen}</Button>
                        ) : (
                          <>
                            {r.status !== 'unresolved' && match !== 'ambiguous' ? <Button size="compact" onClick={() => void decide(r, { action: 'approve' })} loading={busy === r.id}>{d.detail.approve}</Button> : null}
                            <Button size="compact" variant="secondary" onClick={() => setPicking(r)}>{d.detail.choose}</Button>
                            <Button size="compact" variant="ghost" onClick={() => void decide(r, { action: 'skip' })}>{d.detail.skip}</Button>
                          </>
                        )}
                      </span>
                    </Td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {error ? <Notice tone={error === d.detail.onecPending ? 'info' : 'danger'}>{error}</Notice> : null}

      {writable ? (
        <Card title={d.detail.prepare} footer={(
          <span className="flex flex-wrap justify-end gap-2">
            <Button variant="primary" onClick={prepare} loading={preparing}>{preparing ? d.detail.preparing : d.detail.prepare}</Button>
            {prepared ? (
              <>
                <Button onClick={() => void download('receipt_xlsx')} loading={exporting === 'receipt_xlsx'} disabled={prepared.report.imported === 0}>{d.detail.exportReceipt}</Button>
                <Button onClick={() => void download('nomenclature_xlsx')} loading={exporting === 'nomenclature_xlsx'} disabled={prepared.report.newProducts === 0}>{d.detail.exportNomenclature}</Button>
              </>
            ) : null}
          </span>
        )}>
          {prepared ? <PrepareReport prepared={prepared} /> : <p className="text-small text-muted">{d.detail.dryRun}</p>}
        </Card>
      ) : null}

      {picking ? <Picker line={picking} onClose={() => setPicking(null)} onDecide={async (decision) => { if (await decide(picking, decision)) setPicking(null); }} /> : null}
    </div>
  );
}

function issueTitle(i: Line['issues'][number]): string {
  const parts = Object.entries(i.params ?? {}).map(([k, v]) => `${k}: ${v}`);
  if (i.suggestion) parts.push(`→ ${i.suggestion}`);
  return parts.join(' · ');
}

function PrepareReport({ prepared }: { prepared: Prepared }) {
  const { locale, ta } = useI18n();
  const d = ta.didoxX.detail;
  const { report, onec } = prepared;
  const n = (v: number): string => fmtNumber(locale, v);
  return (
    <div className="space-y-3" aria-live="polite">
      {report.dryRun ? <p className="text-small text-muted">{d.dryRun}</p> : null}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-md bg-good-tint p-3"><p className="text-title tabular-nums">{n(report.imported)}</p><p className="text-small">{d.imported}</p></div>
        <div className="rounded-md bg-surface p-3"><p className="text-title tabular-nums">{n(report.skipped)}</p><p className="text-small">{d.skipped}</p></div>
        <div className="rounded-md bg-danger-tint p-3"><p className="text-title tabular-nums">{n(report.rejected)}</p><p className="text-small">{d.rejected}</p></div>
      </div>
      {report.newProducts > 0 ? <p className="text-small">{d.newProducts(report.newProducts)}</p> : null}
      {report.lines.some((l) => l.result !== 'imported') ? (
        <ul className="divide-y divide-line rounded-md border border-line text-small">
          {report.lines.filter((l) => l.result !== 'imported').map((l) => (
            <li key={l.recordId} className="flex flex-wrap justify-between gap-2 px-3 py-1.5">
              <span><span className="text-muted">{l.lineNo}.</span> {l.name}</span>
              <span className={l.result === 'rejected' ? 'text-danger-ink' : 'text-muted'}>
                {l.result === 'rejected' ? d.rejected : d.skipped}: {d.reasons[l.reason ?? ''] ?? l.reason}{l.issue ? ` (${issueText(l.issue, undefined, ta.didoxX.issues, ta.productsX.issues)})` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {!onec.ok ? <Notice tone={onec.error === 'not_implemented' ? 'info' : 'danger'}>{onec.error === 'not_implemented' ? d.onecPending : onec.error}</Notice> : null}
    </div>
  );
}

/** Per-line choice: an existing candidate, a new product, or another MXIK (with the classifier's suggestion and reason). */
function Picker({ line, onClose, onDecide }: { line: Line; onClose: () => void; onDecide: (decision: Decision) => Promise<void> }) {
  const { ta } = useI18n();
  const d = ta.didoxX.detail;
  const [choice, setChoice] = useState<string>(line.payload.product.chosen?.id ?? (line.payload.product.candidates[0]?.id ?? 'new'));
  const [mxik, setMxik] = useState<string>(line.payload.mxik ?? line.issues.find((i) => i.suggestion && /^\d{17}$/.test(i.suggestion))?.suggestion ?? '');
  const [suggestion, setSuggestion] = useState<{ id: string; label: string; reason?: string } | null>(null);
  const [asked, setAsked] = useState(false);
  const [saving, start] = useTransition();

  const ask = (): void => {
    setAsked(true);
    void api.didox.suggestion({ recordId: line.id }).then((s) => setSuggestion(s.suggestion)).catch(() => setSuggestion(null));
  };

  const apply = (): void => {
    start(async () => {
      const corrections: { product?: string; mxik?: string } = { product: choice };
      if (mxik && mxik !== line.payload.mxik) corrections.mxik = mxik;
      await onDecide({ action: 'correct', corrections });
    });
  };

  return (
    <Dialog open onClose={onClose} title={d.chooseTitle} description={`${line.payload.lineNo}. ${line.payload.name}`} size="lg" footer={(
      <>
        <Button variant="ghost" onClick={onClose}>{ta.didoxX.sheet.cancel}</Button>
        <Button variant="primary" onClick={apply} loading={saving} disabled={mxik !== '' && !/^\d{17}$/.test(mxik)}>{d.apply}</Button>
      </>
    )}>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-small font-medium">{d.existing}</legend>
        {line.payload.product.candidates.map((c) => (
          <label key={c.id} className="flex items-start gap-2 text-data">
            <input type="radio" name="product" value={c.id} checked={choice === c.id} onChange={() => setChoice(c.id)} className="mt-1" />
            <span>
              <span className="font-medium">{c.label}</span> <span className="text-small text-muted">{Math.round(c.confidence * 100)}%</span>
              {c.reason ? <span className="block text-small text-muted">{c.reason}</span> : null}
            </span>
          </label>
        ))}
        <label className="flex items-center gap-2 text-data">
          <input type="radio" name="product" value="new" checked={choice === 'new'} onChange={() => setChoice('new')} />
          <span className="font-medium">{d.createNew}</span>
        </label>
      </fieldset>
      <div className="mt-4 space-y-2">
        <Field label={d.otherMxik}><Input value={mxik} onChange={(e) => setMxik(e.target.value.replace(/\D/g, '').slice(0, 17))} inputMode="numeric" className="font-mono" /></Field>
        {!asked ? <Button size="sm" variant="ghost" onClick={ask}>{d.suggestion}</Button> : suggestion ? (
          <div className="rounded-md border border-line p-3 text-small">
            <p className="font-medium">{d.suggestion}: <span className="font-mono">{suggestion.id}</span> — {suggestion.label}</p>
            {suggestion.reason ? <p className="text-muted">{suggestion.reason}</p> : null}
            <Button size="compact" className="mt-2" onClick={() => setMxik(suggestion.id)}>{d.apply}</Button>
          </div>
        ) : <p className="text-small text-muted">{d.noSuggestion}</p>}
      </div>
    </Dialog>
  );
}
