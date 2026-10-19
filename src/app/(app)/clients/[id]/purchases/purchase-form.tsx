'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { applyPurchases, uploadPurchases, type ListPreview } from '@/app/actions/purchases';
import { Dropzone } from '@/app/(app)/upload/dropzone';
import { Notice } from '@/app/(app)/upload/notice';
import { useI18n } from '@/lib/locale-client';
import type { PurchaseMap } from '@/lib/purchases';
import { useToast } from '@/ui/toast';
import { ListMapper, type MapperField } from './list-mapper';

export function purchaseFields(labels: { mxik: string; name: string; unit: string }): MapperField<keyof PurchaseMap>[] {
  return [
    { key: 'mxik', label: labels.mxik, required: true },
    { key: 'name', label: labels.name, required: false },
    { key: 'unit', label: labels.unit, required: false },
  ];
}

/** Apply the mapping of a purchase list; zero valid codes keeps the list unused and the mapper open. */
export function PurchaseMapper({ listId, filename, headers, rows, map, notes, onClose }: {
  listId: string; filename: string; headers: string[]; rows: string[][]; map: PurchaseMap; notes?: ReactNode; onClose?: () => void;
}) {
  const { t, ta } = useI18n();
  const router = useRouter();
  const toast = useToast();
  return (
    <ListMapper
      title={ta.importX.lists.resumeTitle(filename)} headers={headers} rows={rows} initial={map} notes={notes}
      fields={purchaseFields(ta.importX.fields)} submitLabel={t.purchasesApply} onClose={onClose}
      onSubmit={async (chosen) => {
        const outcome = await applyPurchases({ listId, map: chosen });
        if (!outcome.ok) return outcome;
        toast(ta.importX.purchases.applied(outcome.codes));
        onClose?.();
        router.refresh();
        return { ok: true };
      }}
    />
  );
}

/** Upload a purchase file, then choose its columns. */
export function PurchaseForm({ clientId }: { clientId: string }) {
  const { ta } = useI18n();
  const router = useRouter();
  const [preview, setPreview] = useState<(ListPreview & { map: PurchaseMap }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, start] = useTransition();

  const choose = (file: File): void => {
    const form = new FormData();
    form.set('file', file);
    form.set('clientId', clientId);
    setError(null);
    setPreview(null);
    start(async () => {
      const result = await uploadPurchases(form).catch(() => ({ ok: false as const, error: ta.importX.errors.network }));
      if (!result.ok) { setError(result.error); return; }
      setPreview(result.preview);
      // The stored list now shows below as "columns not chosen", resumable later.
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {preview ? null : <Dropzone onFile={choose} busy={reading} compact />}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {preview ? (
        <PurchaseMapper
          listId={preview.listId} filename={preview.filename} headers={preview.headers} rows={preview.rows} map={preview.map}
          notes={preview.truncated ? <Notice tone="danger">{ta.importX.lists.truncated(preview.totalRows, preview.totalSeen)}</Notice> : undefined}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
