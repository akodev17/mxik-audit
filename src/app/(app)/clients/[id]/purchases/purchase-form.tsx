'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useState, useTransition } from 'react';
import { applyPurchases, uploadPurchases, type PurchaseUploadState } from '@/app/actions/purchases';
import { t } from '@/lib/i18n';
import type { PurchaseMap } from '@/lib/purchases';
import { Button } from '@/ui/button';
import { ColumnSelect } from '@/ui/column-select';
import { PreviewTable } from '@/ui/preview-table';

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
      <label className="inline-flex h-10 cursor-pointer items-center rounded-ctl border border-line-strong px-4 text-[15px] font-medium hover:bg-surface">
        {t.purchasesUpload}
        <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) choose(f); }} />
      </label>
      {uploading ? <p className="text-sm text-muted">{t.loading}</p> : null}
      {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}

      {preview && active ? (
        <div className="space-y-3 rounded-ctl border border-line p-4">
          <p className="text-sm text-muted">{preview.filename}, {t.uploadRowsFound(preview.totalRows)}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {FIELDS.map((field) => (
              <ColumnSelect
                key={field.key} label={field.label} required={field.required} headers={preview.headers}
                value={active[field.key]} onChange={(v) => setMap({ ...active, [field.key]: v })}
              />
            ))}
          </div>
          <PreviewTable headers={preview.headers} rows={preview.rows} roles={FIELDS.map((f) => [active[f.key], f.label])} />
          <Button variant="primary" onClick={apply} disabled={applying}>{applying ? t.loading : t.purchasesApply}</Button>
        </div>
      ) : null}
      {result ? <p className="text-sm text-good">{result}</p> : null}
    </div>
  );
}
