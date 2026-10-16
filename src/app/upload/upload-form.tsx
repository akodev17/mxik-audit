'use client';

import { startTransition, useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { commitUpload, previewUpload, type PreviewState } from '@/app/actions/catalog';
import type { ColumnMap } from '@/lib/column-map';
import { t } from '@/lib/i18n';

const FIELDS: { key: keyof ColumnMap; label: string; required: boolean }[] = [
  { key: 'name', label: t.uploadColumnName, required: true },
  { key: 'barcode', label: t.uploadColumnBarcode, required: false },
  { key: 'mxik', label: t.uploadColumnMxik, required: false },
  { key: 'unit', label: t.uploadColumnUnit, required: false },
  { key: 'price', label: t.uploadColumnPrice, required: false },
];

type ClientOption = { id: string; name: string };

export function UploadForm({ hadPreviousMapping, clients, initialClientId }: {
  hadPreviousMapping: boolean;
  clients: ClientOption[];
  initialClientId: string;
}) {
  const [clientId, setClientId] = useState(initialClientId);
  const [state, action, previewing] = useActionState<PreviewState, FormData>(previewUpload, {});
  const [mapping, setMapping] = useState<ColumnMap | null>(null);
  const [dragging, setDragging] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [committing, startCommit] = useTransition();
  const router = useRouter();

  const preview = state.preview;
  const active = mapping ?? preview?.suggested ?? null;

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
      // The audit now runs in the background; the report shows its progress.
      else router.push(result.catalogId ? `/report?catalog=${result.catalogId}` : '/report');
    });
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl">{t.uploadTitle}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t.uploadHint}</p>
      </section>

      {clients.length > 1 ? (
        <label className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          <span>{t.uploadClient}:</span>
          <select
            name="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)}
            disabled={preview !== undefined}
            className="max-w-full border border-rule bg-paper px-2 py-1.5 text-ink focus:border-ink focus:outline-none"
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
          className={`flex cursor-pointer flex-col items-center justify-center border-2 border-dashed px-6 py-12 text-center ${
            dragging ? 'border-ink bg-paper-tint' : 'border-rule'
          }`}
        >
          <span className="font-serif text-lg">{t.uploadDrop}</span>
          <span className="mt-1 text-sm text-ink-soft underline">{t.uploadChoose}</span>
          <input
            type="file" name="file" accept=".xlsx,.csv" className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) submitFile(file);
            }}
          />
        </label>
      </form>

      {previewing ? <p className="text-sm text-ink-soft">{t.loading}</p> : null}
      {state.error ? (
        <p role="alert" className="border-l-2 border-risk bg-risk-tint px-3 py-2 text-sm text-risk">
          {state.error}
        </p>
      ) : null}

      {preview && active ? (
        <>
          <section>
            <h2 className="text-lg">{t.uploadMapTitle}</h2>
            <p className="mt-1 text-sm text-ink-soft">{t.uploadMapHint}</p>
            {hadPreviousMapping ? (
              <p className="mt-1 text-xs text-ink-faint">{t.uploadRemembered}</p>
            ) : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((field) => (
                <div key={field.key}>
                  <label htmlFor={`map-${field.key}`} className="block text-sm text-ink-soft">
                    {field.label}
                    {field.required ? <span className="text-risk"> *</span> : null}
                  </label>
                  <select
                    id={`map-${field.key}`}
                    value={active[field.key]}
                    onChange={(e) => setMapping({ ...active, [field.key]: Number(e.target.value) })}
                    className="mt-1 w-full border border-rule bg-paper px-2 py-1.5 focus:border-ink focus:outline-none"
                  >
                    {!field.required ? <option value={-1}>{t.uploadColumnIgnore}</option> : null}
                    {preview.headers.map((h, i) => (
                      <option key={i} value={i}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg">{t.uploadPreviewTitle}</h2>
            <p className="mt-1 text-sm text-ink-soft">{t.uploadRowsFound(preview.totalRows)}</p>
            <div className="mt-3 overflow-x-auto border border-rule">
              <table className="min-w-full text-sm">
                <thead className="bg-paper-tint">
                  <tr>
                    {preview.headers.map((h, i) => {
                      const role = FIELDS.find((f) => active[f.key] === i);
                      return (
                        <th key={i} className="border-b border-rule px-3 py-2 text-left font-medium">
                          <span className="block">{h}</span>
                          {role ? (
                            <span className="block text-xs font-normal text-ok">{role.label}</span>
                          ) : null}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, r) => (
                    <tr key={r} className="border-b border-rule last:border-0">
                      {preview.headers.map((_, c) => (
                        <td key={c} className="px-3 py-1.5 whitespace-nowrap text-ink-soft">
                          {row[c] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {commitError ? (
            <p role="alert" className="border-l-2 border-risk bg-risk-tint px-3 py-2 text-sm text-risk">
              {commitError}
            </p>
          ) : null}

          <button
            type="button" onClick={commit} disabled={committing}
            className="bg-ink px-5 py-2.5 text-paper disabled:opacity-50"
          >
            {committing ? t.uploadAnalyzing : t.uploadStart}
          </button>
          {committing ? (
            <p className="mt-2 text-sm text-ink-soft">
              {t.uploadRowsFound(preview.totalRows)} — {t.uploadAnalyzing}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
