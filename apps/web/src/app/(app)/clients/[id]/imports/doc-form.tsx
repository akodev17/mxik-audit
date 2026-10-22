'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { applyDoc, uploadDoc } from '@/app/actions/docs';
import type { ListPreview } from '@/app/actions/purchases';
import { ListMapper, type MapperField } from '@/app/(app)/clients/[id]/purchases/list-mapper';
import { Dropzone } from '@/app/(app)/upload/dropzone';
import { Notice } from '@/app/(app)/upload/notice';
import type { DocKind, DocMap } from '@/lib/docs';
import { useI18n } from '@/lib/locale-client';
import { useToast } from '@/ui/toast';
import { goTo } from '@/ui/shell/same-route-links';

/** Confirm the columns of a stored cheque or sales list and start its check. */
export function DocMapper({ clientId, kind, listId, filename, headers, rows, map, notes, onClose }: {
  clientId: string; kind: DocKind; listId: string; filename: string; headers: string[]; rows: string[][]; map: DocMap; notes?: ReactNode; onClose?: () => void;
}) {
  const { ta } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const f = ta.importX.fields;
  const fields: MapperField<keyof DocMap>[] = [
    { key: 'name', label: f.name, required: false },
    { key: 'mxik', label: f.mxik, required: true },
    { key: 'unit', label: f.unit, required: false },
    { key: 'quantity', label: ta.docs.colQuantity, required: false },
    { key: 'amount', label: ta.docs.colAmount, required: false },
    ...(kind === 'sales' ? [{ key: 'date' as const, label: ta.docs.colDate, required: false }] : []),
  ];
  return (
    <ListMapper
      title={ta.importX.lists.resumeTitle(filename)} headers={headers} rows={rows} initial={map} notes={notes}
      fields={fields} submitLabel={ta.docs.start} onClose={onClose}
      onSubmit={async (chosen) => {
        const outcome = await applyDoc({ listId, map: chosen });
        if (!outcome.ok) return outcome;
        toast(ta.importX.docs.started);
        goTo(`/clients/${clientId}/imports/${listId}`, (href) => router.push(href));
        return { ok: true };
      }}
    />
  );
}

/** Upload a list, confirm its columns, start the check. */
export function DocForm({ clientId, kind }: { clientId: string; kind: DocKind }) {
  const { ta } = useI18n();
  const router = useRouter();
  const [preview, setPreview] = useState<(ListPreview & { map: DocMap }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, start] = useTransition();

  const choose = (file: File): void => {
    const form = new FormData();
    form.set('file', file);
    form.set('clientId', clientId);
    form.set('kind', kind);
    setError(null);
    setPreview(null);
    start(async () => {
      const result = await uploadDoc(form).catch(() => ({ ok: false as const, error: ta.importX.errors.network }));
      if (!result.ok) { setError(result.error); return; }
      setPreview(result.preview);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-small"><a href={`/api/doc-template?kind=${kind}`} download className="font-medium text-brand-ink hover:underline">{ta.docs.template}</a></p>
      {preview ? null : <Dropzone onFile={choose} busy={reading} compact />}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {preview ? (
        <DocMapper
          clientId={clientId} kind={kind} listId={preview.listId} filename={preview.filename} headers={preview.headers} rows={preview.rows} map={preview.map}
          notes={preview.truncated ? <Notice tone="danger">{ta.importX.lists.truncated(preview.totalRows, preview.totalSeen)}</Notice> : undefined}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
