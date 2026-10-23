'use client';

import type { UploadPreview } from '@/lib/catalogs/types';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { IconSuccess, IconTable } from '@/ui/icons';
import { PreviewTable } from '@/ui/preview-table';
import { Notice } from './notice';
import { StepCard, StepFooter } from './step-card';

/** Step 2: what the reader made of the file, before any mapping. */
export function FileCheck({ preview, onNext, onStartOver }: { preview: UploadPreview; onNext: () => void; onStartOver: () => void }) {
  const { locale, ta } = useI18n();
  const c = ta.importX.check;
  const f = ta.importX.flow;
  const n = (v: number): string => fmtNumber(locale, v);
  const parse = preview.parse;
  const repeatedHeaders = parse?.repeatedHeadersSkipped ?? 0;
  const facts: [string, string][] = [
    ...(parse ? [
      [c.format, c.formats[parse.format]] as [string, string],
      ...(parse.encoding ? [[c.encoding, parse.encoding === 'utf-8' ? 'UTF-8' : 'Windows-1251'] as [string, string]] : []),
      ...(parse.delimiter ? [[c.delimiter, c.delimiters[parse.delimiter]] as [string, string]] : []),
      [c.headerRow, c.headerAt(parse.headerRow)] as [string, string],
    ] : []),
    [c.rows, n(preview.rows)],
  ];

  return (
    <StepCard titleId="check-title" title={c.title}>
      {/* The summary: which file, how big, and how it was read. */}
      <div className="flex flex-wrap items-start gap-4 rounded-md bg-surface p-4">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-md bg-good-tint text-good-ink"><IconTable size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-small font-medium text-good-ink"><IconSuccess size={14} />{f.readOk}</p>
          <p className="mt-0.5 break-words text-data font-semibold">
            <span className="sr-only">{ta.importX.confirm.file}: </span>{preview.filename}
          </p>
          <p className="text-small text-muted">{f.rows(preview.rows)} · {f.columns(preview.headers.length)}</p>
        </div>
        <dl className="grid w-full grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-3 sm:grid-cols-3 lg:w-auto lg:grid-cols-none lg:grid-flow-col lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-small text-muted">{label}</dt>
              <dd className="break-words text-data font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {parse?.truncated ? (
        <Notice tone="danger" title={c.truncatedTitle(preview.rows, parse.totalSeen)}>{c.truncatedHint}</Notice>
      ) : null}
      {parse && (parse.skippedAbove > 0 || parse.emptyRowsSkipped > 0 || repeatedHeaders > 0) ? (
        <Notice tone="info">
          {parse.skippedAbove > 0 ? <p>{c.skippedAbove(parse.skippedAbove)}</p> : null}
          {parse.emptyRowsSkipped > 0 ? <p>{c.emptySkipped(parse.emptyRowsSkipped)}</p> : null}
          {repeatedHeaders > 0 ? <p>{c.repeatedHeaders(repeatedHeaders)}</p> : null}
        </Notice>
      ) : null}

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 className="text-data font-semibold">{c.sample}</h3>
          <p className="text-small text-muted">{f.kindHint}</p>
        </div>
        <PreviewTable
          headers={preview.headers} rows={preview.sample} roles={[]} limit={preview.sample.length} label={c.sample}
          kindLabels={f.kinds} kindHint={f.kindHint}
        />
      </div>

      <StepFooter>
        <Button variant="ghost" onClick={onStartOver}>{ta.importX.discard.action}</Button>
        <Button variant="primary" onClick={onNext}>{c.next}</Button>
      </StepFooter>
    </StepCard>
  );
}
