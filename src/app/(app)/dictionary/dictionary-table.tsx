'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteMapping, updateMapping } from '@/app/actions/dictionary';
import { ta } from '@/lib/i18n-app';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { Input } from '@/ui/input';
import { Table, Td, Th } from '@/ui/table';

export type DictRow = {
  id: string; kind: string; label: string; unit: string | null; code: string; codeName: string | null;
  uses: number; stale: boolean; updated: string;
};

function Row({ row, canEdit }: { row: DictRow; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(row.code);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const save = (): void => start(async () => {
    const result = await updateMapping({ id: row.id, code: code.trim() });
    if (result.ok) { setEditing(false); setError(null); router.refresh(); } else setError(result.error ?? '');
  });

  return (
    <tr className="hover:bg-surface/60">
      <Td className="max-w-sm">
        <span className="block truncate font-medium" title={row.label}>{row.label}</span>
        {row.unit ? <span className="text-xs text-muted">{row.unit}</span> : null}
      </Td>
      <Td>{row.kind === 'barcode' ? ta.dict.kindBarcode : ta.dict.kindName}</Td>
      <Td className="max-w-sm">
        {editing ? (
          <span className="flex items-center gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={17} className="h-8 w-48 font-mono text-xs" aria-label={ta.dict.edit} />
            <Button size="sm" variant="primary" disabled={busy} onClick={save}>OK</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setCode(row.code); setError(null); }}>✕</Button>
          </span>
        ) : (
          <span className="flex min-w-0 flex-col items-start gap-0.5">
            <CodeChip code={row.code} />
            {row.stale ? <Badge tone="danger">{ta.dict.stale}</Badge> : <span className="max-w-full truncate text-xs text-muted" title={row.codeName ?? undefined}>{row.codeName}</span>}
          </span>
        )}
        {error ? <span role="alert" className="block text-xs text-danger">{error}</span> : null}
      </Td>
      <Td className="text-right">{row.uses}</Td>
      <Td className="whitespace-nowrap text-muted">{row.updated}</Td>
      <Td>
        {canEdit ? (
          <span className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setEditing(true)} disabled={editing}>{ta.dict.edit}</Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => { if (window.confirm(ta.dict.deleteConfirm)) start(async () => { await deleteMapping(row.id); router.refresh(); }); }}>{ta.dict.delete}</Button>
          </span>
        ) : null}
      </Td>
    </tr>
  );
}

export function DictionaryTable({ rows, canEdit }: { rows: DictRow[]; canEdit: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>{ta.dict.colName}</Th><Th>{ta.dict.colKind}</Th><Th>{ta.dict.colCode}</Th>
          <Th className="text-right">{ta.dict.colUses}</Th><Th>{ta.dict.colUpdated}</Th><Th><span className="sr-only">—</span></Th>
        </tr>
      </thead>
      <tbody>{rows.map((r) => <Row key={r.id} row={r} canEdit={canEdit} />)}</tbody>
    </Table>
  );
}
