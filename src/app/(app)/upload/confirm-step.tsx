'use client';

import type { ImportDiagnostics } from '@/lib/import-diagnostics';
import { fmtDate } from '@/lib/format';
import { useI18n } from '@/lib/locale-client';
import type { UploadPreview } from '@/lib/upload-preview';
import { Button, ButtonLink } from '@/ui/button';
import { Notice } from './notice';

type Props = {
  preview: UploadPreview;
  diagnostics: ImportDiagnostics;
  busy: boolean;
  error: string | null;
  /** Set when the server says the upload was already committed: offer the catalogue instead. */
  committedId: string | null;
  onBack: () => void;
  onStart: () => void;
};

/** Step 4: what will happen, said plainly before anything is audited. */
export function ConfirmStep({ preview, diagnostics, busy, error, committedId, onBack, onStart }: Props) {
  const { locale, ta } = useI18n();
  const c = ta.importX.confirm;
  const parse = preview.parse;
  const notRead = parse?.truncated ? Math.max(0, parse.totalSeen - diagnostics.rows) : 0;

  return (
    <section aria-labelledby="confirm-title" className="space-y-4">
      <h2 id="confirm-title" className="text-section">{c.title}</h2>
      <dl className="grid gap-x-6 gap-y-2 rounded-ctl border border-line bg-raised p-4 sm:grid-cols-2">
        <div className="flex min-w-0 gap-2 text-data"><dt className="shrink-0 text-muted">{c.file}:</dt><dd className="min-w-0 break-words font-medium">{preview.filename}</dd></div>
        <div className="flex min-w-0 gap-2 text-data"><dt className="shrink-0 text-muted">{c.client}:</dt><dd className="min-w-0 break-words font-medium">{preview.client.name}</dd></div>
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
        <Notice tone="danger" action={committedId ? <ButtonLink href={`/upload?catalog=${committedId}`} size="sm">{c.openCatalog}</ButtonLink> : undefined}>
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
