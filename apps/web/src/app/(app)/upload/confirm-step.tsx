'use client';

import type { ReactNode } from 'react';
import type { ColumnMap, ImportDiagnostics, UploadPreview } from '@/lib/catalogs/types';
import { fmtDate } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { Button, ButtonLink } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconAlert, IconCheck, IconError, IconInfo } from '@/ui/icons';
import { Notice } from './notice';
import { StepCard, StepFooter } from './step-card';

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

type Mark = 'ok' | 'warn' | 'danger' | 'info';

const MARK: Record<Mark, { icon: ReactNode; className: string }> = {
  ok: { icon: <IconCheck size={14} />, className: 'bg-good-tint text-good-ink' },
  warn: { icon: <IconAlert size={14} />, className: 'bg-warn-tint text-warn-ink' },
  danger: { icon: <IconError size={14} />, className: 'bg-danger-tint text-danger-ink' },
  info: { icon: <IconInfo size={14} />, className: 'bg-sunken text-muted' },
};

/** A checklist line: a round mark that says ok / look / problem / note, then the sentence. */
function Check({ mark, children, className }: { mark: Mark; children: ReactNode; className?: string }) {
  return (
    <li className={cx('flex items-start gap-3', className)}>
      <span aria-hidden className={cx('mt-px grid size-5 shrink-0 place-items-center rounded-full', MARK[mark].className)}>{MARK[mark].icon}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** Step 4: what was chosen and what will happen, as a checklist, before anything is audited. */
export function ConfirmStep({ preview, mapping, diagnostics, busy, error, committedId, onBack, onStart }: Props) {
  const { locale, ta } = useI18n();
  const c = ta.importX.confirm;
  const f = ta.importX.flow;
  const fields = ta.importX.fields;
  const parse = preview.parse;
  const notRead = parse?.truncated ? Math.max(0, parse.totalSeen - diagnostics.rows) : 0;
  const column = (index: number): string => {
    const header = index >= 0 ? preview.headers[index] : undefined;
    return header === undefined ? c.noColumn : c.column(header);
  };
  const facts: [string, string, boolean][] = [
    [c.file, preview.filename, true],
    [c.client, preview.client.name, true],
    [fields.name, column(mapping.name), mapping.name >= 0],
    [fields.mxik, column(mapping.mxik), mapping.mxik >= 0],
  ];

  return (
    <StepCard titleId="confirm-title" title={c.title}>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="min-w-0">
          <h3 className="text-small font-semibold text-muted">{f.chosen}</h3>
          <dl className="mt-2 divide-y divide-line rounded-md bg-surface px-4">
            {facts.map(([label, value, set]) => (
              <div key={label} className="flex min-w-0 items-start gap-3 py-2.5 text-data">
                <span aria-hidden className={cx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', set ? MARK.ok.className : MARK.info.className)}>
                  {set ? MARK.ok.icon : MARK.info.icon}
                </span>
                <dt className="w-28 shrink-0 text-muted sm:w-32">{label}</dt>
                <dd className="min-w-0 break-words font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="min-w-0">
          <h3 className="text-small font-semibold text-muted">{f.whatNext}</h3>
          <ul className="mt-2 space-y-3 text-data">
            <Check mark="ok"><span className="font-medium">{c.rows(diagnostics.importable)}</span></Check>
            {diagnostics.noName.count > 0 ? <Check mark="warn">{c.dropped(diagnostics.noName.count)}</Check> : null}
            {notRead > 0 ? <Check mark="danger"><span className="font-medium text-danger-ink">{c.truncated(notRead)}</span></Check> : null}
            <Check mark="info">{preview.previous ? c.previous(preview.previous.filename, fmtDate(locale, preview.previous.createdAt), preview.previous.rowCount) : c.noPrevious}</Check>
            {preview.previous ? <Check mark="ok">{c.carry}</Check> : null}
            <Check mark="info" className="text-small text-muted">{c.quota}</Check>
          </ul>
        </div>
      </div>
      {error ? (
        <Notice tone="danger" action={committedId ? <ButtonLink href={`/upload?catalog=${committedId}`} size="sm" reload>{c.openCatalog}</ButtonLink> : undefined}>
          {error}
        </Notice>
      ) : null}
      <StepFooter>
        <Button variant="ghost" onClick={onBack} disabled={busy}>{c.back}</Button>
        <Button variant="primary" loading={busy} onClick={onStart}>{c.start}</Button>
      </StepFooter>
    </StepCard>
  );
}
