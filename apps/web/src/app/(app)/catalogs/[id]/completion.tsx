'use client';

import Link from 'next/link';
import { api } from '@/lib/api/browser';
import { useI18n } from '@/lib/locale-client';
import { ButtonLink } from '@/ui/button';
import { IconDownload, IconSuccess } from '@/ui/icons';
import { ShareButton } from './share-button';
import { count } from './ws-text';

type Props = { catalogId: string; clientId: string; findings: number; exportLocked: boolean; canShare: boolean; onShowDecided: () => void };

/**
 * Shown when every risky finding has a decision: the next steps, not an empty table. Downloading the file
 * or the PDF, or sending the client a link, is the checklist's "deliver the result" step.
 */
export function Completion({ catalogId, clientId, findings, exportLocked, canShare, onShowDecided }: Props) {
  const { ta, locale } = useI18n();
  const d = ta.wsX.done;
  return (
    <section className="no-print mx-4 my-4 flex gap-3 rounded-lg border border-good/40 bg-good-tint p-4 md:mx-5" aria-labelledby="ws-done-title">
      <IconSuccess size={22} className="mt-0.5 shrink-0 text-good-ink" />
      <div className="min-w-0">
        <h2 id="ws-done-title" className="text-section text-good-ink">{d.title}</h2>
        <p className="mt-1 text-data text-fg">{count(locale, d.hint, findings)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {exportLocked ? <p className="text-small text-muted">{d.exportLocked}</p> : (
            <ButtonLink variant="primary" size="sm" href={api.catalogs.exportFile.url({ catalog: catalogId })} download><IconDownload />{d.export}</ButtonLink>
          )}
          <ButtonLink size="sm" href={api.catalogs.exportPdf.url({ catalog: catalogId })} target="_blank">{d.pdf}</ButtonLink>
          {canShare ? <ShareButton catalogId={catalogId} size="sm" /> : null}
          <button type="button" onClick={onShowDecided} className="rounded-sm text-small font-medium text-brand-ink hover:underline">{d.decided}</button>
          <Link href={`/clients/${clientId}`} className="rounded-sm text-small font-medium text-brand-ink hover:underline">{d.client}</Link>
        </div>
      </div>
    </section>
  );
}
