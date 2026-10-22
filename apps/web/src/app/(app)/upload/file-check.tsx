'use client';

import type { UploadPreview } from '@tasnivo/domain/upload-preview';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { PreviewTable } from '@/ui/preview-table';
import { Notice } from './notice';

/** Step 2: what the reader made of the file, before any mapping. */
export function FileCheck({ preview, onNext, onStartOver }: { preview: UploadPreview; onNext: () => void; onStartOver: () => void }) {
  const { locale, ta } = useI18n();
  const c = ta.importX.check;
  const n = (v: number): string => fmtNumber(locale, v);
  const parse = preview.parse;
  const repeatedHeaders = parse?.repeatedHeadersSkipped ?? 0;
  const facts: [string, string][] = [
    [ta.importX.confirm.file, preview.filename],
    ...(parse ? [
      [c.format, c.formats[parse.format]] as [string, string],
      ...(parse.encoding ? [[c.encoding, parse.encoding === 'utf-8' ? 'UTF-8' : 'Windows-1251'] as [string, string]] : []),
      ...(parse.delimiter ? [[c.delimiter, c.delimiters[parse.delimiter]] as [string, string]] : []),
      [c.headerRow, c.headerAt(parse.headerRow)] as [string, string],
    ] : []),
    [c.rows, n(preview.rows)],
  ];

  return (
    <section aria-labelledby="check-title" className="space-y-4">
      <h2 id="check-title" className="text-section">{c.title}</h2>
      {parse?.truncated ? (
        <Notice tone="danger" title={c.truncatedTitle(preview.rows, parse.totalSeen)}>{c.truncatedHint}</Notice>
      ) : null}
      <dl className="grid gap-x-6 gap-y-2 rounded-ctl border border-line bg-raised p-4 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="flex min-w-0 gap-2 text-data">
            <dt className="shrink-0 text-muted">{label}:</dt>
            <dd className="min-w-0 break-words font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {parse && (parse.skippedAbove > 0 || parse.emptyRowsSkipped > 0 || repeatedHeaders > 0) ? (
        <Notice tone="info">
          {parse.skippedAbove > 0 ? <p>{c.skippedAbove(parse.skippedAbove)}</p> : null}
          {parse.emptyRowsSkipped > 0 ? <p>{c.emptySkipped(parse.emptyRowsSkipped)}</p> : null}
          {repeatedHeaders > 0 ? <p>{c.repeatedHeaders(repeatedHeaders)}</p> : null}
        </Notice>
      ) : null}
      <div>
        <h3 className="mb-2 text-data font-semibold">{c.sample}</h3>
        <PreviewTable headers={preview.headers} rows={preview.sample} roles={[]} limit={preview.sample.length} label={c.sample} />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={onStartOver}>{ta.importX.discard.action}</Button>
        <Button variant="primary" onClick={onNext}>{c.next}</Button>
      </div>
    </section>
  );
}
