'use client';

import type { ColumnMap } from '@tasnivo/domain/column-map';
import type { ImportDiagnostics } from '@tasnivo/domain/import-diagnostics';
import { fmtDate } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import type { UploadPreview } from '@tasnivo/domain/upload-preview';
import { Button, ButtonLink } from '@/ui/button';
import { Notice } from './notice';

type Props = {
  preview: UploadPreview;
  /** The mapping being confirmed: the name and code columns are shown so a wrong one is caught here. */
  mapping: ColumnMap;
  diagnostics: ImportDiagnostics;
  busy: boolean;
  error: string | null;
  /** Set when the server says the upload was already committed: offer the catalogue instead. */
  committedId: string | null;
  onBack: () => void;
  onStart: () => void;
};

/** Step 4: what will happen, said plainly before anything is audited. */
export function ConfirmStep({ preview, mapping, diagnostics, busy, error, committedId, onBack, onStart }: Props) {
  const { locale, ta } = useI18n();
  const c = ta.importX.confirm;
  const fields = ta.importX.fields;
  const parse = preview.parse;
  const notRead = parse?.truncated ? Math.max(0, parse.totalSeen - diagnostics.rows) : 0;
  const column = (index: number): string => {
    const header = index >= 0 ? preview.headers[index] : undefined;
    return header === undefined ? c.noColumn : c.column(header);
  };
  const facts: [string, string][] = [
    [c.file, preview.filename],
    [c.client, preview.client.name],
    [fields.name, column(mapping.name)],
    [fields.mxik, column(mapping.mxik)],
  ];

  return (
    <section aria-labelledby="confirm-title" className="space-y-4">
      <h2 id="confirm-title" className="text-section">{c.title}</h2>
      <dl className="grid gap-x-6 gap-y-2 rounded-ctl border border-line bg-raised p-4 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="flex min-w-0 gap-2 text-data">
            <dt className="shrink-0 text-muted">{label}:</dt>
            <dd className="min-w-0 break-words font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <ul className="list-disc space-y-1.5 pl-5 text-data">
        <li>{c.rows(diagnostics.importable)}</li>
        {diagnostics.noName.count > 0 ? <li>{c.dropped(diagnostics.noName.count)}</li> : null}
        {notRead > 0 ? <li className="font-medium text-danger-ink">{c.truncated(notRead)}</li> : null}
        <li>{preview.previous ? c.previous(preview.previous.filename, fmtDate(locale, preview.previous.createdAt), preview.previous.rowCount) : c.noPrevious}</li>
        {preview.previous ? <li>{c.carry}</li> : null}
        <li className="text-muted">{c.quota}</li>
      </ul>
      {error ? (
        <Notice tone="danger" action={committedId ? <ButtonLink href={`/upload?catalog=${committedId}`} size="sm" reload>{c.openCatalog}</ButtonLink> : undefined}>
          {error}
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={onBack} disabled={busy}>{c.back}</Button>
        <Button variant="primary" loading={busy} onClick={onStart}>{c.start}</Button>
      </div>
    </section>
  );
}
