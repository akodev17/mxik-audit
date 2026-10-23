'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import type { PurchaseMap } from '@/lib/pure/types';
import { api } from '@/lib/api/browser';
import { orRefused } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { ButtonLink } from '@/ui/button';
import { IconDownload } from '@/ui/icons';
import { useToast } from '@/ui/toast';
import { Card } from '../../../_manage/card';
import { FileDrop } from '../../../_manage/file-drop';
import { ListFlow } from '../../../_manage/list-flow';
import { Notice } from '../../../_manage/notice';
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
        const outcome = await orRefused(api.imports.applyPurchases({ listId, map: chosen }), ta.importX.errors.network);
        if (!outcome.ok) return outcome;
        toast(ta.importX.purchases.applied(outcome.codes));
        onClose?.();
        router.refresh();
        return { ok: true };
      }}
    />
  );
}

type PurchasePreview = Extract<ResponseOf<typeof endpoints.imports.uploadPurchases>, { ok: true }>['preview'];

/** Upload a purchase file, then choose its columns: the same file → columns → result stages as every list. */
export function PurchaseForm({ clientId }: { clientId: string }) {
  const { t, ta } = useI18n();
  const router = useRouter();
  const [preview, setPreview] = useState<PurchasePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, start] = useTransition();

  const choose = (file: File): void => {
    setError(null);
    setPreview(null);
    start(async () => {
      const result = await orRefused(api.imports.uploadPurchases({ file }, { clientId }), ta.importX.errors.network);
      if (!result.ok) { setError(result.error); return; }
      setPreview(result.preview);
      // The stored list now shows below as "columns not chosen", resumable later.
      router.refresh();
    });
  };

  return (
    <ListFlow step={preview ? 1 : 0}>
      {preview ? (
        <PurchaseMapper
          listId={preview.listId} filename={preview.filename} headers={preview.headers} rows={preview.rows} map={preview.map}
          notes={preview.truncated ? <Notice tone="danger">{ta.importX.lists.truncated(preview.totalRows, preview.totalSeen)}</Notice> : undefined}
          onClose={() => setPreview(null)}
        />
      ) : (
        <Card
          title={ta.mgX.clients.upload.purchases} hint={ta.mgX.clients.upload.hint} as="h2"
          actions={<ButtonLink href="/api/purchase-template" download variant="ghost" size="sm"><IconDownload size={16} />{t.purchasesTemplate}</ButtonLink>}
        >
          <div className="space-y-3">
            <FileDrop onFile={choose} busy={reading} />
            {error ? <Notice tone="danger">{error}</Notice> : null}
          </div>
        </Card>
      )}
    </ListFlow>
  );
}
