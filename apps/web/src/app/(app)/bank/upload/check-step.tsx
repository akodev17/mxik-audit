'use client';

import { useState } from 'react';
import { fmtDate } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { Badge } from '@/ui/badge';
import { Button, ButtonLink } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Input } from '@/ui/input';
import { PreviewTable } from '@/ui/preview-table';
import { Table, Td, Th } from '@/ui/table';
import { Card, Fact } from '../../_manage/card';
import { Notice } from '../../_manage/notice';
import { money, ROLE_ORDER } from '../bank-pure';
import type { Preview } from './bank-upload';

/**
 * What will be read before anything is stored: the statement's header (bank, account, period,
 * balances), the layout (recognised, saved by the org, or just chosen — with an offer to remember
 * it), the first lines with their columns labelled, and every row left out with the reason.
 */
export function CheckStep({ preview, busy, onBack, onColumns, onRead }: {
  preview: Preview; busy: boolean; onBack: () => void; onColumns: () => void; onRead: (formatName: string | null) => void;
}) {
  const { locale, ta } = useI18n();
  const b = ta.bankX;
  const u = b.upload;
  const [remember, setRemember] = useState(!preview.recognised);
  const [name, setName] = useState(preview.header.bankName ?? u.formatNameDefault(preview.filename));
  const h = preview.header;
  const roles: [number, string][] = ROLE_ORDER.flatMap((r) => ((preview.columnMap[r] ?? -1) >= 0 ? [[preview.columnMap[r] ?? -1, b.roles[r]] as [number, string]] : []));
  const period = h.periodFrom ? (h.periodTo && h.periodTo !== h.periodFrom ? `${fmtDate(locale, h.periodFrom)} — ${fmtDate(locale, h.periodTo)}` : fmtDate(locale, h.periodFrom)) : u.notStated;

  return (
    <Card title={preview.filename} as="h2">
      <div className="space-y-5">
        {preview.duplicateOf?.batchId && preview.duplicateOf.createdAt ? (
          <Notice tone="danger" action={<ButtonLink href={`/bank/${preview.duplicateOf.batchId}`} size="sm">{u.openEarlier}</ButtonLink>}>
            {u.duplicate(fmtDate(locale, preview.duplicateOf.createdAt))}
          </Notice>
        ) : preview.duplicateOf ? <Notice tone="danger">{u.duplicateElsewhere}</Notice> : null}
        {preview.format ? (
          <Notice tone={preview.format.verified ? 'good' : 'warn'} action={<Button size="sm" variant="ghost" onClick={onColumns}>{u.changeColumns}</Button>}>
            <span className="font-medium">{preview.format.builtIn ? u.recognised(preview.format.name) : u.savedFormat(preview.format.name)}</span>
            {!preview.format.verified ? <span className="block">{u.unverified}</span> : null}
          </Notice>
        ) : (
          <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={onColumns}>{u.changeColumns}</Button></div>
        )}

        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={u.bank}>{h.bankName ?? u.notStated}</Fact>
          <Fact label={u.account}><span className="font-mono">{h.account ?? u.notStated}</span></Fact>
          <Fact label={u.period}>{period}</Fact>
          <Fact label={u.currency}>{h.currency ?? u.notStated}</Fact>
          <Fact label={u.opening}>{h.openingBalance !== null ? money(h.openingBalance) : u.notStated}</Fact>
          <Fact label={u.closing}>{h.closingBalance !== null ? money(h.closingBalance) : u.notStated}</Fact>
        </dl>

        <div className="flex flex-wrap gap-2 text-data">
          <Badge tone="good">{u.dataRows(preview.dataRows)}</Badge>
          {preview.dropped.length > 0 ? <Badge tone="neutral">{u.dropped(preview.dropped.length)}</Badge> : null}
        </div>
        {preview.truncated ? <Notice tone="warn">{u.truncated(preview.dataRows, preview.totalRows)}</Notice> : null}

        <PreviewTable headers={preview.headers} rows={preview.rows} roles={roles} label={u.sample} limit={6} maxHeight="18rem" />

        {preview.dropped.length > 0 ? (
          <details className="rounded-md border border-line p-3">
            <summary className="cursor-pointer text-data font-medium">{u.droppedTitle} ({preview.dropped.length})</summary>
            <Table label={u.droppedTitle} density="compact" className="mt-2">
              <thead><tr><Th numeric>{u.droppedRow}</Th><Th>{u.droppedWhy}</Th><Th>{ta.bankX.edit.raw}</Th></tr></thead>
              <tbody>
                {preview.dropped.map((d) => (
                  <tr key={d.rowIndex}>
                    <Td numeric>{d.rowIndex}</Td>
                    <Td className="whitespace-nowrap">{(b.dropReasons as Record<string, string>)[d.reason] ?? d.reason}</Td>
                    <Td className="max-w-md truncate text-muted" title={d.text}>{d.text}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </details>
        ) : null}

        {!preview.format ? (
          <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
            <Checkbox label={u.saveFormat} checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            {remember ? <Input aria-label={u.formatName} placeholder={u.formatName} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /> : null}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onBack}>{u.again}</Button>
          <Button variant="primary" loading={busy} disabled={preview.duplicateOf !== null || preview.dataRows === 0} onClick={() => onRead(remember && name.trim() && !preview.format ? name.trim() : null)}>
            {u.read}
          </Button>
        </div>
      </div>
    </Card>
  );
}
