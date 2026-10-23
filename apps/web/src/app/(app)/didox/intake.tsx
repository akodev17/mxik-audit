'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type DragEvent } from 'react';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { api } from '@/lib/api/browser';
import { orRefused } from '@/lib/api/refusal';
import { fmtDateTime } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { Button, ButtonLink } from '@/ui/button';
import { ColumnSelect } from '@/ui/column-select';
import { cx } from '@/ui/cx';
import { IconGear, IconUpload } from '@/ui/icons';
import { Field, Input } from '@/ui/input';
import { PreviewTable } from '@/ui/preview-table';
import { Select } from '@/ui/select';
import { Card } from '../_manage/card';
import { Notice } from '../_manage/notice';

type Upload = Extract<ResponseOf<typeof endpoints.didox.upload>, { ok: true }>;
type Documents = Extract<Upload, { kind: 'documents' }>;
type Sheet = Extract<Upload, { kind: 'sheet' }>;
type SyncDone = Extract<ResponseOf<typeof endpoints.didox.sync>, { ok: true }>;

const ACCEPT = '.zip,.json,.xlsx,application/zip,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const REQUIRED = new Set(['name', 'quantity']);

/**
 * The two ways in: drop a Didox zip export / document JSON / ЭСФ spreadsheet, or fetch new incoming
 * invoices through the connection. A spreadsheet stops at the column and header step; the same
 * file is sent again with the confirmed mapping, so nothing half-made is stored.
 */
export function DidoxIntake({ clients, clientId, connected, lastSync, writable, admin }: {
  clients: Array<{ id: string; name: string }>; clientId: string | null; connected: boolean; lastSync: string | null; writable: boolean; admin: boolean;
}) {
  const { locale, ta } = useI18n();
  const d = ta.didoxX;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [client, setClient] = useState<string>(clientId ?? clients[0]?.id ?? '');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Documents | null>(null);
  const [sheet, setSheet] = useState<{ file: File; data: Sheet } | null>(null);
  const [synced, setSynced] = useState<SyncDone | null>(null);
  const [busy, start] = useTransition();
  const [syncing, startSync] = useTransition();

  const choose = (file: File): void => {
    setError(null);
    setResult(null);
    setSheet(null);
    start(async () => {
      const res = await orRefused(api.didox.upload({ file, ...(client ? { clientId: client } : {}) }), d.errors.generic);
      if (!res.ok) { setError(res.error); return; }
      if (res.kind === 'sheet') { setSheet({ file, data: res }); return; }
      setResult(res);
      router.refresh();
    });
  };

  const sync = (): void => {
    setError(null);
    setSynced(null);
    startSync(async () => {
      const res = await orRefused(api.didox.sync({}), d.errors.generic);
      if (!res.ok) { setError(res.error); return; }
      setSynced(res);
      router.refresh();
    });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && !busy) choose(file);
  };

  if (!writable) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card title={d.upload.title} hint={d.upload.hint}>
        <div className="space-y-3">
          {clients.length > 0 ? (
            <Select label={d.upload.client} value={client} onChange={(e) => setClient(e.target.value)} wrapperClassName="sm:w-72">
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          ) : null}
          <div
            onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            aria-busy={busy || undefined}
            className={cx(
              'flex flex-col items-center gap-3 rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors duration-(--duration-fast) sm:flex-row sm:text-left',
              dragging ? 'border-brand bg-brand-tint' : 'border-line-strong bg-surface',
            )}
          >
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-raised text-muted shadow-sm"><IconUpload size={20} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-data font-medium">
                <span className="pointer-coarse:hidden">{busy ? d.upload.reading : d.upload.drop}</span>
                <span className="hidden pointer-coarse:inline">{busy ? d.upload.reading : d.upload.dropTouch}</span>
              </p>
              <p className="mt-0.5 text-small text-muted">{d.upload.formats}</p>
            </div>
            <Button variant="secondary" loading={busy} onClick={() => input.current?.click()} className="shrink-0">{d.upload.choose}</Button>
            <input
              ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden
              onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) choose(file); }}
            />
          </div>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {result ? <UploadOutcome result={result} /> : null}
        </div>
      </Card>

      <Card title={d.nav.invoices} hint={connected ? `${d.sync.lastSync}: ${lastSync ? fmtDateTime(locale, lastSync) : d.sync.never}` : d.sync.notConnected}>
        <div className="flex flex-col items-start gap-3">
          <Button variant="primary" onClick={sync} loading={syncing} disabled={!connected}>{syncing ? d.sync.running : d.sync.button}</Button>
          {synced ? <Notice tone="good">{d.sync.done(synced.imported, synced.skipped)}</Notice> : null}
          {admin ? <ButtonLink href="/didox/settings" size="sm" variant="ghost" leadingIcon={<IconGear size={14} />}>{d.nav.settings}</ButtonLink> : null}
        </div>
      </Card>

      {sheet ? (
        <div className="lg:col-span-2">
          <SheetMapper file={sheet.file} data={sheet.data} clientId={client} onClose={() => setSheet(null)} />
        </div>
      ) : null}
    </div>
  );
}

function UploadOutcome({ result }: { result: Documents }) {
  const { ta } = useI18n();
  const d = ta.didoxX;
  const done = result.items.filter((i) => i.ok);
  const refused = result.items.filter((i) => !i.ok);
  return (
    <div className="space-y-2" aria-live="polite">
      <p className="text-data font-medium">{d.upload.resultTitle}</p>
      <ul className="space-y-1 text-small">
        {done.length > 0 ? <li className="text-good-ink">{d.upload.imported(done.length)}</li> : null}
        {refused.length > 0 ? <li className="text-danger-ink">{d.upload.refused(refused.length)}</li> : null}
        {result.skipped.length > 0 ? <li className="text-muted">{d.upload.skippedEntries(result.skipped.length)}</li> : null}
      </ul>
      <ul className="divide-y divide-line rounded-md border border-line">
        {result.items.map((item) => (
          <li key={item.entry} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-small">
            <span className="min-w-0 truncate font-mono text-muted" title={item.entry}>{item.entry}</span>
            {item.ok ? (
              <Link className="font-medium text-brand-ink underline-offset-2 hover:underline" href={`/didox/${item.batchId}`}>{d.upload.open}</Link>
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-danger-ink">{item.error}</span>
                {item.duplicateOf ? <Link className="font-medium text-brand-ink underline-offset-2 hover:underline" href={`/didox/${item.duplicateOf.batchId}`}>{d.upload.earlier}</Link> : null}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Column mapping and the typed header of an ЭСФ spreadsheet (layout unverified, so the user confirms it). */
function SheetMapper({ file, data, clientId, onClose }: { file: File; data: Sheet; clientId: string; onClose: () => void }) {
  const { ta } = useI18n();
  const d = ta.didoxX;
  const s = d.sheet;
  const router = useRouter();
  const [map, setMap] = useState<Record<string, number>>(data.preview.map);
  const [header, setHeader] = useState({ number: '', date: '', sellerTin: '', sellerName: '', buyerTin: '', contractNumber: '', contractDate: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const fields = data.preview.fields as Array<keyof typeof s.fields>;
  const set = (k: keyof typeof header) => (e: { target: { value: string } }) => setHeader({ ...header, [k]: e.target.value });
  const ready = header.number && header.date && /^(\d{9}|\d{14})$/.test(header.sellerTin) && header.sellerName && (map['name'] ?? -1) >= 0 && (map['quantity'] ?? -1) >= 0;

  const submit = (): void => {
    setError(null);
    start(async () => {
      const res = await orRefused(api.didox.commitSheet({ file, map: JSON.stringify(map), header: JSON.stringify(header), ...(clientId ? { clientId } : {}) }), d.errors.generic);
      if (!res.ok) { setError(res.error); return; }
      router.push(`/didox/${res.batchId}`);
    });
  };

  return (
    <Card title={s.title} hint={s.hint} footer={(
      <span className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{s.cancel}</Button>
        <Button variant="primary" onClick={submit} loading={saving} disabled={!ready}>{s.commit}</Button>
      </span>
    )}>
      <div className="space-y-4">
        <p className="text-small text-muted">{data.filename} · {s.rows(data.preview.totalRows)}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={s.number}><Input value={header.number} onChange={set('number')} required /></Field>
          <Field label={s.date}><Input type="date" value={header.date} onChange={set('date')} required /></Field>
          <Field label={s.sellerTin}><Input value={header.sellerTin} onChange={set('sellerTin')} inputMode="numeric" maxLength={14} required /></Field>
          <Field label={s.sellerName}><Input value={header.sellerName} onChange={set('sellerName')} required /></Field>
          <Field label={s.buyerTin}><Input value={header.buyerTin} onChange={set('buyerTin')} inputMode="numeric" maxLength={14} /></Field>
          <Field label={s.contractNumber}><Input value={header.contractNumber} onChange={set('contractNumber')} /></Field>
          <Field label={s.contractDate}><Input type="date" value={header.contractDate} onChange={set('contractDate')} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {fields.map((f) => (
            <ColumnSelect key={f} label={s.fields[f]} required={REQUIRED.has(f)} headers={data.preview.headers} value={map[f] ?? -1} onChange={(i) => setMap({ ...map, [f]: i })} />
          ))}
        </div>
        <PreviewTable headers={data.preview.headers} rows={data.preview.rows} roles={fields.map((f) => [map[f] ?? -1, s.fields[f]] as [number, string])} limit={6} label={s.title} />
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </div>
    </Card>
  );
}
