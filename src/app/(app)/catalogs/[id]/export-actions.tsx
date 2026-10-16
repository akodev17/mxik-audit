'use client';

import { useI18n } from '@/lib/locale-client';
import { useState, type ReactNode } from 'react';
import { Button, ButtonLink } from '@/ui/button';
import { IconDownload, IconPrint } from '@/ui/icons';

type Props = { catalogId: string; locked: boolean; panel: ReactNode; share?: ReactNode };

/** Excel export (behind payment when billing requires it), 1C CSV, PDF report, print. */
export function ExportActions({ catalogId, locked, panel, share }: Props) {
  const { ta } = useI18n();
  const [open, setOpen] = useState(false);
  const pdf = `/api/report-pdf?catalog=${catalogId}`;
  return (
    <div className="no-print relative flex flex-wrap items-center gap-2">
      {locked ? (
        <Button variant="primary" onClick={() => setOpen((o) => !o)} aria-expanded={open}><IconDownload />{ta.ws.exportXlsx}</Button>
      ) : (
        <ButtonLink variant="primary" href={`/api/export?catalog=${catalogId}`} download><IconDownload />{ta.ws.exportXlsx}</ButtonLink>
      )}
      {locked ? null : <ButtonLink href={`/api/export?catalog=${catalogId}&format=1c`} download>{ta.ws.export1c}</ButtonLink>}
      <ButtonLink href={pdf} target="_blank">{ta.ws.pdf}</ButtonLink>
      {share}
      <ButtonLink href={pdf} target="_blank" variant="ghost"><IconPrint />{ta.ws.print}</ButtonLink>
      {locked && open ? (
        <div className="absolute right-0 top-12 z-40 w-[360px] rounded-ctl border border-line bg-base p-4 shadow-pop">{panel}</div>
      ) : null}
    </div>
  );
}
