'use client';

import { useI18n } from '@/lib/locale-client';
import { startTransition, useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { commitUpload, previewUpload, type PreviewState } from '@/app/actions/catalog';
import type { ColumnMap } from '@/lib/column-map';
import { applyPreset, IMPORT_PRESETS, presetLabel } from '@/lib/import-presets';
import { Button } from '@/ui/button';
import { ColumnSelect } from '@/ui/column-select';
import { PreviewTable } from '@/ui/preview-table';
import { Stepper } from '@/ui/stepper';

type ClientOption = { id: string; name: string };

export function UploadForm({ hadPreviousMapping, clients, initialClientId }: {
  hadPreviousMapping: boolean;
  clients: ClientOption[];
  initialClientId: string;
}) {
  const { t, ta } = useI18n();
  const FIELDS: { key: keyof ColumnMap; label: string; required: boolean }[] = [
    { key: 'name', label: t.uploadColumnName, required: true },
    { key: 'barcode', label: t.uploadColumnBarcode, required: false },
    { key: 'mxik', label: t.uploadColumnMxik, required: false },
    { key: 'unit', label: t.uploadColumnUnit, required: false },
    { key: 'price', label: t.uploadColumnPrice, required: false },
    { key: 'sales', label: t.uploadColumnSales, required: false },
  ];
  const [clientId, setClientId] = useState(initialClientId);
  const [state, action, previewing] = useActionState<PreviewState, FormData>(previewUpload, {});
  const [mapping, setMapping] = useState<ColumnMap | null>(null);
  const [dragging, setDragging] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [committing, startCommit] = useTransition();
  const router = useRouter();

  const preview = state.preview;
  const active = mapping ?? preview?.suggested ?? null;
  // File read, columns mapped, audit started, then the workspace opens.
  const stage = committing ? 2 : preview ? 1 : 0;

  function submitFile(file: File): void {
    const form = new FormData();
    form.set('file', file);
    form.set('clientId', clientId);
    setMapping(null);
    setCommitError(null);
    // useActionState's dispatch must run inside a transition or isPending lies.
    startTransition(() => action(form));
  }

  function commit(): void {
    if (!preview || !active) return;
    setCommitError(null);
    startCommit(async () => {
      // Only the id and the mapping cross the wire; the rows stay server-side.
      const result = await commitUpload({ catalogId: preview.catalogId, mapping: active });
      if (result.error) setCommitError(result.error);
      // The audit runs in the background; the workspace shows its progress, then the riskiest rows.
      else router.push(result.catalogId ? `/catalogs/${result.catalogId}` : '/catalogs');
    });
  }

  return (
    <div className="space-y-6">
      <Stepper stages={ta.upload.stages} current={stage} />

      {clients.length > 1 ? (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t.uploadClient}:</span>
          <select
            value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={preview !== undefined}
            className="h-10 max-w-full rounded-ctl border border-line-strong bg-base px-2 text-[15px] focus:border-brand focus:outline-none"
          >
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      ) : null}

      <form action={action}>
        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) submitFile(file);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-ctl border-2 border-dashed px-6 text-center transition-colors ${
            preview ? 'py-6' : 'py-20'
          } ${dragging ? 'border-brand bg-brand-tint' : 'border-line-strong bg-surface hover:bg-brand-tint/50'}`}
        >
          <span className="text-lg font-bold">{previewing ? ta.upload.reading : ta.upload.dropTitle}</span>
          <span className="mt-1 text-sm text-muted">{ta.upload.dropHint}</span>
          <input
            type="file" name="file" accept=".xlsx,.csv" className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) submitFile(file);
            }}
          />
        </label>
      </form>

      {state.error ? (
        <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{state.error}</p>
      ) : null}

      {preview && active ? (
        <>
          <section>
            <h2 className="text-lg">{t.uploadMapTitle}</h2>
            <p className="mt-1 text-sm text-muted">{ta.upload.mapped} {hadPreviousMapping ? t.uploadRemembered : ''}</p>
            <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{t.uploadPreset}:</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  const preset = IMPORT_PRESETS.find((p) => p.id === e.target.value);
                  setMapping(preset ? applyPreset(preset, preview.headers, preview.suggested) : null);
                }}
                className="h-9 rounded-ctl border border-line-strong bg-base px-2 focus:border-brand focus:outline-none"
              >
                <option value="">{t.uploadPresetAuto}</option>
                {IMPORT_PRESETS.map((p) => <option key={p.id} value={p.id}>{presetLabel(p)}</option>)}
              </select>
              <span className="text-xs text-muted">{t.uploadPresetHint}</span>
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((field) => (
                <ColumnSelect
                  key={field.key} label={field.label} required={field.required} headers={preview.headers}
                  value={active[field.key]} onChange={(v) => setMapping({ ...active, [field.key]: v })}
                />
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg">{ta.upload.sample}</h2>
            <p className="mb-3 mt-1 text-sm text-muted">{t.uploadRowsFound(preview.totalRows)}</p>
            <PreviewTable headers={preview.headers} rows={preview.rows} roles={FIELDS.map((f) => [active[f.key], f.label])} />
          </section>

          {commitError ? <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{commitError}</p> : null}

          <Button variant="primary" onClick={commit} disabled={committing}>{committing ? ta.upload.starting : ta.upload.confirm}</Button>
        </>
      ) : null}
    </div>
  );
}
