'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api/browser';
import { isNetworkFailure } from '@/lib/api-failure';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { Badge, StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { Field, Input } from '@/ui/input';
import { Table, Td, Th } from '@/ui/table';
import { useToast } from '@/ui/toast';

export type DictRow = {
  id: string; kind: string; label: string; unit: string | null; code: string; codeName: string | null;
  uses: number; confirmations: number; source: string | null; stale: boolean; updated: string;
  /** E-mail of whoever last taught or edited the entry; null when it was not recorded. */
  approver: string | null;
};

const CODE = /^\d{17}$/;

/**
 * How much people stood behind an entry: individual confirmations, or only bulk accepts.
 * Entries learned before provenance was recorded have no source and no count: unknown, not "bulk only".
 */
function Trust({ row }: { row: DictRow }) {
  const { ta, locale } = useI18n();
  const x = ta.wsX.dict;
  const source = row.source ? x.sourceLabel[row.source] : null;
  let badge: ReactNode;
  if (row.confirmations > 0) badge = <Badge tone="good" icon={<StatusIcon tone="good" size={12} />}>{x.confirmed(fmtNumber(locale, row.confirmations), row.confirmations)}</Badge>;
  else if (row.source === null) badge = <Badge tone="neutral" icon={<StatusIcon tone="neutral" size={12} />} title={x.noHistoryHint}>{x.noHistory}</Badge>;
  else badge = <Badge tone="warn" icon={<StatusIcon tone="warn" size={12} />}>{x.bulkOnly}</Badge>;
  return (
    <span className="flex flex-col items-start gap-0.5">
      {badge}
      {source ? <span className="text-micro text-muted">{source}</span> : null}
      <span className="max-w-48 truncate text-micro text-muted" title={row.approver ?? undefined}>{x.colApprover}: {row.approver ?? x.approverUnknown}</span>
    </span>
  );
}

function Row({ row, canEdit }: { row: DictRow; canEdit: boolean }) {
  const { ta, locale } = useI18n();
  const x = ta.wsX.dict;
  const queryClient = useQueryClient();
  const toast = useToast();
  // The listing on screen is refetched: counts, stale marks and the row itself change.
  const refetch = (): void => { void queryClient.invalidateQueries({ queryKey: ['dictionary'] }); };
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(row.code);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Accepting an unverified entry is pointing it at the code it already has: one manual confirmation.
  async function accept(): Promise<void> {
    setBusy(true);
    try {
      const result = await api.dictionary.update({ entryId: row.id, code: row.code });
      if (!result.ok) { toast(result.error ?? ta.wsX.toast.failed, { tone: 'error' }); return; }
      toast(ta.wsUi.dict.accepted);
      refetch();
    } catch (error) {
      toast(isNetworkFailure(error) ? ta.wsX.toast.network : ta.wsX.toast.failed, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    const value = code.replace(/\s+/g, '');
    if (!CODE.test(value)) { setError(x.codeFormat); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await api.dictionary.update({ entryId: row.id, code: value });
      if (!result.ok) { setError(result.error ?? ta.wsX.toast.failed); return; }
      setEditing(false);
      toast(x.savedToast);
      refetch();
    } catch (error) {
      setError(isNetworkFailure(error) ? ta.wsX.toast.network : ta.wsX.toast.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="transition-colors duration-(--duration-fast) hover:bg-surface">
      <Td className="max-w-sm">
        <span className="block truncate font-medium text-fg" title={row.label}>{row.label}</span>
        {row.unit ? <span className="text-micro text-muted">{row.unit}</span> : null}
      </Td>
      <Td>{row.kind === 'barcode' ? ta.dict.kindBarcode : ta.dict.kindName}</Td>
      <Td className="min-w-56 max-w-sm">
        {editing ? (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Field label={x.codeLabel} hint={x.editHint} error={error ?? undefined}>
              <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} inputMode="numeric" size="compact" className="font-mono" autoFocus />
            </Field>
            <span className="flex gap-2">
              <Button type="submit" size="sm" variant="primary" loading={busy}>{x.save}</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setCode(row.code); setError(null); }}>{x.cancel}</Button>
            </span>
          </form>
        ) : (
          <span className="flex min-w-0 flex-col items-start gap-0.5">
            <CodeChip code={row.code} />
            {row.stale
              ? <Badge tone="danger">{ta.wsX.codeState.archived}</Badge>
              : <span className="max-w-full truncate text-micro text-muted" title={row.codeName ?? undefined}>{row.codeName ?? ta.wsX.codeState.unknown}</span>}
          </span>
        )}
      </Td>
      <Td><Trust row={row} /></Td>
      <Td numeric>{fmtNumber(locale, row.uses)}</Td>
      <Td className="whitespace-nowrap text-muted">{row.updated}</Td>
      <Td>
        {canEdit && !editing ? (
          <span className="flex justify-end gap-1.5">
            {row.confirmations === 0 && !row.stale ? (
              <Button size="compact" variant="secondary" loading={busy} onClick={() => { void accept(); }} aria-label={ta.wsUi.dict.acceptLabel(row.label)} title={ta.wsUi.dict.acceptHint}>
                {ta.wsUi.dict.accept}
              </Button>
            ) : null}
            <Button size="compact" variant={row.stale ? 'secondary' : 'ghost'} disabled={busy} onClick={() => setEditing(true)} aria-label={`${x.edit}: ${row.label}`}>{x.edit}</Button>
            <Button size="compact" variant="danger-ghost" disabled={busy} onClick={() => setConfirmDelete(true)} aria-label={`${x.delete}: ${row.label}`}>{x.delete}</Button>
          </span>
        ) : null}
        <ConfirmDialog
          open={confirmDelete} onClose={() => setConfirmDelete(false)}
          title={x.deleteTitle} description={x.deleteBody} scope={row.label} tone="danger" confirmLabel={x.deleteConfirm}
          onConfirm={async () => {
            const result = await api.dictionary.remove({ entryId: row.id }).catch((error: unknown) => ({ ok: false, error: isNetworkFailure(error) ? ta.wsX.toast.network : ta.wsX.toast.failed }));
            if (!result.ok) return { ok: false, error: result.error };
            toast(x.deleted);
            refetch();
            return { ok: true };
          }}
        />
      </Td>
    </tr>
  );
}

export function DictionaryTable({ rows, canEdit }: { rows: DictRow[]; canEdit: boolean }) {
  const { ta } = useI18n();
  return (
    <Table label={ta.dict.title}>
      <thead>
        <tr>
          <Th>{ta.dict.colName}</Th><Th>{ta.dict.colKind}</Th><Th>{ta.dict.colCode}</Th><Th>{ta.wsX.dict.colConfirmed}</Th>
          <Th numeric>{ta.dict.colUses}</Th><Th>{ta.dict.colUpdated}</Th><Th><span className="sr-only">{ta.wsX.dict.actions}</span></Th>
        </tr>
      </thead>
      <tbody>{rows.map((r) => <Row key={r.id} row={r} canEdit={canEdit} />)}</tbody>
    </Table>
  );
}
