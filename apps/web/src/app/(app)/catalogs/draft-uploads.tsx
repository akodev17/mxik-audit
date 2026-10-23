'use client';

import Link from 'next/link';
import { fmtDateTime } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { ButtonLink } from '@/ui/button';
import type { ListedCatalog } from './catalog-list';
import { IconAlert } from '@/ui/icons';
import { VisuallyHidden } from '@/ui/visually-hidden';

/**
 * Uploads whose columns were never confirmed: not catalogues yet, so they sit apart with a way
 * back into the upload wizard instead of an "Open" that leads nowhere useful.
 */
export function DraftUploads({ drafts, showClient }: { drafts: ListedCatalog[]; showClient: boolean }) {
  const { locale, ta } = useI18n();
  if (drafts.length === 0) return null;
  const words = ta.firmX.catalogs;
  return (
    <section aria-labelledby="draft-uploads" className="relative mb-5 overflow-hidden rounded-lg border border-line bg-raised">
      <div className="flex items-start gap-3 border-b border-line bg-warn-tint px-4 py-3">
        <IconAlert size={18} className="mt-px shrink-0 text-warn-ink" />
        <div className="min-w-0">
          <h2 id="draft-uploads" className="text-data font-semibold text-warn-ink">{words.draftsTitle}</h2>
          <p className="text-small text-warn-ink">{words.draftsHint}</p>
        </div>
      </div>
      <ul className="divide-y divide-line px-4">
        {drafts.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
            <span className="min-w-0">
              <span className="block truncate font-medium" title={d.filename}>{d.filename}</span>
              <span className="block text-small text-muted">
                {showClient && d.clientId && d.clientName
                  ? <><Link href={`/clients/${d.clientId}`} className="text-brand-ink hover:underline">{d.clientName}</Link> · </>
                  : null}
                <time dateTime={new Date(d.createdAt).toISOString()} className="tabular-nums">{fmtDateTime(locale, d.createdAt)}</time>
                {d.uploader ? ` · ${d.uploader}` : ''}
              </span>
            </span>
            <ButtonLink href={`/upload?catalog=${encodeURIComponent(d.id)}`} size="sm" variant="secondary">
              {words.resume}<VisuallyHidden>: {d.filename}</VisuallyHidden>
            </ButtonLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
