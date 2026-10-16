'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useState, useTransition } from 'react';
import { applyDoc, uploadDoc, type DocUploadState } from '@/app/actions/docs';
import type { DocKind, DocMap } from '@/lib/docs';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { ColumnSelect } from '@/ui/column-select';
import { PreviewTable } from '@/ui/preview-table';

/** Upload a list, confirm its columns, start the check. */
export function DocForm({ clientId, kind }: { clientId: string; kind: DocKind }) {
  const { t, ta } = useI18n();
  const router = useRouter();
  const [state, action, uploading] = useActionState<DocUploadState, FormData>(uploadDoc, {});
  const [map, setMap] = useState<DocMap | null>(null);
  const [applying, startApply] = useTransition();
  const preview = state.preview;
  const active = map ?? preview?.map ?? null;
  const fields: { key: keyof DocMap; label: string; required: boolean }[] = [
    { key: 'name', label: t.uploadColumnName, required: false },
    { key: 'mxik', label: t.uploadColumnMxik, required: true },
    { key: 'unit', label: t.uploadColumnUnit, required: false },
    { key: 'quantity', label: ta.docs.colQuantity, required: false },
    { key: 'amount', label: ta.docs.colAmount, required: false },
    ...(kind === 'sales' ? [{ key: 'date' as const, label: ta.docs.colDate, required: false }] : []),
  ];

  function choose(file: File): void {
    const form = new FormData();
    form.set('file', file);
    form.set('clientId', clientId);
    form.set('kind', kind);
    setMap(null);
    startTransition(() => action(form));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="inline-flex h-10 cursor-pointer items-center rounded-ctl border border-line-strong px-4 text-[15px] font-medium hover:bg-surface">
          {ta.docs.upload}
          <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) choose(f); }} />
        </label>
        <a href={`/api/doc-template?kind=${kind}`} className="text-sm font-medium text-brand hover:underline">{ta.docs.template}</a>
      </div>
      {uploading ? <p className="text-sm text-muted">{t.loading}</p> : null}
      {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      {preview && active ? (
        <div className="space-y-3 rounded-ctl border border-line p-4">
          <p className="text-sm text-muted">{preview.filename}, {t.uploadRowsFound(preview.totalRows)}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {fields.map((f) => (
              <ColumnSelect key={f.key} label={f.label} required={f.required} headers={preview.headers} value={active[f.key]} onChange={(v) => setMap({ ...active, [f.key]: v })} />
            ))}
          </div>
          <PreviewTable headers={preview.headers} rows={preview.rows} roles={fields.map((f) => [active[f.key], f.label])} />
          <Button variant="primary" disabled={applying} onClick={() => startApply(async () => { await applyDoc({ listId: preview.listId, map: active }); router.refresh(); })}>
            {applying ? t.loading : ta.docs.start}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
