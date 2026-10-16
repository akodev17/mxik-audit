'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useState, useTransition } from 'react';
import { applyPurchases, uploadPurchases, type PurchaseUploadState } from '@/app/actions/purchases';
import { t } from '@/lib/i18n';
import type { PurchaseMap } from '@/lib/purchases';

const FIELDS: { key: keyof PurchaseMap; label: string; required: boolean }[] = [
  { key: 'mxik', label: t.uploadColumnMxik, required: true },
  { key: 'name', label: t.uploadColumnName, required: false },
  { key: 'unit', label: t.uploadColumnUnit, required: false },
];

export function PurchaseForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [state, action, uploading] = useActionState<PurchaseUploadState, FormData>(uploadPurchases, {});
  const [map, setMap] = useState<PurchaseMap | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [applying, startApply] = useTransition();
  const preview = state.preview;
  const active = map ?? preview?.map ?? null;

  function choose(file: File): void {
    const form = new FormData();
    form.set('file', file);
    form.set('clientId', clientId);
    setMap(null);
    setResult(null);
    startTransition(() => action(form));
  }

  function apply(): void {
    if (!preview || !active) return;
    startApply(async () => {
      const outcome = await applyPurchases({ listId: preview.listId, map: active });
      setResult(outcome.ok ? t.purchasesApplied(outcome.codes) : outcome.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <label className="inline-block cursor-pointer border border-ink px-4 py-2 text-sm hover:bg-paper-tint">
        {t.purchasesUpload}
        <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) choose(f); }} />
      </label>
      {uploading ? <p className="text-sm text-ink-soft">{t.loading}</p> : null}
      {state.error ? <p role="alert" className="text-sm text-risk">{state.error}</p> : null}

      {preview && active ? (
        <div className="space-y-3 border border-rule p-4">
          <p className="text-sm text-ink-soft">{preview.filename} · {t.uploadRowsFound(preview.totalRows)}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {FIELDS.map((field) => (
              <label key={field.key} className="block text-sm text-ink-soft">
                {field.label}{field.required ? <span className="text-risk"> *</span> : null}
                <select
                  value={active[field.key]}
                  onChange={(e) => setMap({ ...active, [field.key]: Number(e.target.value) })}
                  className="mt-1 w-full border border-rule bg-paper px-2 py-1.5 text-ink focus:border-ink focus:outline-none"
                >
                  {!field.required ? <option value={-1}>{t.uploadColumnIgnore}</option> : null}
                  {preview.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="overflow-x-auto border border-rule">
            <table className="min-w-full text-xs">
              <thead className="bg-paper-tint">
                <tr>{preview.headers.map((h, i) => <th key={i} className="px-2 py-1 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {preview.rows.map((row, r) => (
                  <tr key={r} className="border-t border-rule">
                    {preview.headers.map((_, c) => <td key={c} className="whitespace-nowrap px-2 py-1 text-ink-soft">{row[c] ?? ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={apply} disabled={applying} className="bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50">
            {applying ? t.loading : t.purchasesApply}
          </button>
        </div>
      ) : null}
      {result ? <p className="text-sm text-ok">{result}</p> : null}
    </div>
  );
}
