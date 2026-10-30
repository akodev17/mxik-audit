'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { api } from '@/lib/api/browser';
import { failureText } from '@/lib/catalogs/client';
import { hasUploadExtension } from '@/lib/catalogs/upload';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { ColumnSelect } from '@/ui/column-select';
import { PreviewTable } from '@/ui/preview-table';
import { Select } from '@/ui/select';
import { Stepper } from '@/ui/stepper';
import { FileDrop } from '../../_manage/file-drop';
import { fill } from '../labels';
import { BatchView } from './batch-view';

type Preview = Extract<ResponseOf<typeof endpoints.products.importPreview>, { ok: true }>;
type Mapping = Preview['mapping'];
const FIELDS = ['name', 'onecRef', 'article', 'mxik', 'packageCode', 'unit', 'barcode', 'price', 'vat'] as const;

type Props = { clients: { id: string; name: string }[]; ownCatalogue: boolean; batchId: string | null };

/** File → columns → (commit) → the batch view, which shows the check's progress and then the review. */
export function ImportWizard({ clients, ownCatalogue, batchId }: Props) {
  const { ta } = useI18n();
  const x = ta.productsX.importWizard;
  const router = useRouter();
  const [clientId, setClientId] = useState(ownCatalogue ? '' : clients[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [clearEmpty, setClearEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reader = useMutation({ mutationFn: (form: FormData) => api.products.importPreview(form) });
  const committer = useMutation({ mutationFn: (form: FormData) => api.products.importCommit(form) });

  if (batchId) {
    return <BatchView batchId={batchId} stages={[x.steps.file, x.steps.columns, x.steps.check, x.steps.result]} />;
  }

  const read = (f: File): void => {
    if (!hasUploadExtension(f.name)) { setError(ta.importX.errors.fileType); return; }
    const form = new FormData();
    form.set('file', f);
    if (clientId) form.set('clientId', clientId);
    setError(null);
    void (async () => {
      const r = await reader.mutateAsync(form).catch((e: unknown) => ({ ok: false as const, error: failureText(e, ta.importX.errors.network) }));
      if (!r.ok) { setError(r.error); return; }
      setFile(f);
      setPreview(r);
      setMapping(r.mapping);
    })();
  };

  const commit = (): void => {
    if (!file || !mapping) return;
    if (mapping.name < 0) { setError(x.errors.noName); return; }
    const form = new FormData();
    form.set('file', file);
    form.set('mapping', JSON.stringify(mapping));
    if (clearEmpty) form.set('clearEmpty', '1');
    if (clientId) form.set('clientId', clientId);
    setError(null);
    void (async () => {
      const r = await committer.mutateAsync(form).catch((e: unknown) => ({ ok: false as const, error: failureText(e, ta.importX.errors.network) }));
      if (!r.ok) { setError(r.error); return; }
      router.push(`/products/import?batch=${r.batchId}${r.duplicate ? '&duplicate=1' : ''}`);
    })();
  };

  const preset = preview?.presets.find((p) => p.mapping);
  return (
    <>
      <Stepper stages={[x.steps.file, x.steps.columns, x.steps.check, x.steps.result]} current={preview ? 1 : 0} />
      <div className="mt-5 space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {!preview ? (
          <>
            {clients.length > 0 || ownCatalogue ? (
              <Select label={x.client} value={clientId} onChange={(e) => setClientId(e.target.value)} wrapperClassName="max-w-sm">
                {ownCatalogue ? <option value="">{ta.productsX.orgOwn}</option> : null}
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            ) : null}
            <FileDrop onFile={read} busy={reader.isPending} />
          </>
        ) : (
          <>
            <p className="text-small text-muted">{preview.filename} · {fill(x.rows, { n: preview.rowCount })}</p>
            {preview.mappingSource === 'remembered' ? <Alert tone="info">{x.remembered}</Alert> : null}
            {preview.mappingSource === 'preset' && preset && !preset.verified ? <Alert tone="warn" title={x.presetName}>{x.presetUnverified}</Alert> : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {FIELDS.map((f) => (
                <ColumnSelect
                  key={f} label={x.fields[f]} required={f === 'name'} headers={preview.headers}
                  value={mapping?.[f] ?? -1} onChange={(i) => setMapping((m) => (m ? { ...m, [f]: i } : m))}
                />
              ))}
            </div>
            <PreviewTable
              headers={preview.headers} rows={preview.sample} limit={8} label={preview.filename}
              roles={mapping ? FIELDS.map((f) => [mapping[f], x.fields[f]] as [number, string]) : []}
            />
            <Checkbox label={x.clearEmpty} description={x.clearEmptyHint} checked={clearEmpty} onChange={(e) => setClearEmpty(e.target.checked)} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={committer.isPending} onClick={commit}>{x.start}</Button>
              <Button variant="ghost" onClick={() => { setPreview(null); setFile(null); setMapping(null); }}>{ta.productsX.actions.retry}</Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
