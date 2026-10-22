'use client';

import Link from 'next/link';
import { api } from '@/lib/api/browser';
import { useI18n } from '@/lib/locale-client';
import { ButtonLink } from '@/ui/button';
import { IconDownload, IconSuccess } from '@/ui/icons';
import { count } from './ws-text';

type Props = { catalogId: string; clientId: string; findings: number; exportLocked: boolean; onShowDecided: () => void };

/** Shown when every risky finding has a decision: the next steps, not an empty table. */
export function Completion({ catalogId, clientId, findings, exportLocked, onShowDecided }: Props) {
  const { ta, locale } = useI18n();
  const d = ta.wsX.done;
  return (
    <section className="no-print mx-4 my-4 rounded-lg border border-good bg-good-tint p-4 md:mx-5" aria-labelledby="ws-done-title">
      <h2 id="ws-done-title" className="flex items-center gap-2 text-section text-good-ink"><IconSuccess size={18} />{d.title}</h2>
      <p className="mt-1 text-data text-fg">{count(locale, d.hint, findings)}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {exportLocked ? <p className="text-small text-muted">{d.exportLocked}</p> : (
          <ButtonLink variant="primary" size="sm" href={api.catalogs.exportFile.url({ catalog: catalogId })} download><IconDownload />{d.export}</ButtonLink>
        )}
        <ButtonLink size="sm" href={api.catalogs.exportPdf.url({ catalog: catalogId })} target="_blank">{d.pdf}</ButtonLink>
        <button type="button" onClick={onShowDecided} className="text-small font-medium text-brand-ink hover:underline">{d.decided}</button>
        <Link href={`/clients/${clientId}`} className="text-small font-medium text-brand-ink hover:underline">{d.client}</Link>
      </div>
    </section>
  );
}
