import Link from 'next/link';
import type { CatalogListItem } from '@tasnivo/domain/catalogs';
import { fmtDateTime } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { ButtonLink } from '@/ui/button';
import { VisuallyHidden } from '@/ui/visually-hidden';

/**
 * Uploads whose columns were never confirmed: not catalogues yet, so they sit apart with a way
 * back into the upload wizard instead of an "Open" that leads nowhere useful.
 */
export async function DraftUploads({ drafts, showClient }: { drafts: CatalogListItem[]; showClient: boolean }) {
  if (drafts.length === 0) return null;
  const { locale, ta } = await getI18n();
  const words = ta.firmX.catalogs;
  return (
    <section aria-labelledby="draft-uploads" className="mb-5 rounded-ctl border border-line bg-surface px-4 py-3">
      <h2 id="draft-uploads" className="font-medium">{words.draftsTitle}</h2>
      <p className="text-small text-muted">{words.draftsHint}</p>
      <ul className="mt-2 divide-y divide-line">
        {drafts.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
            <span className="min-w-0">
              <span className="block truncate font-medium" title={d.filename}>{d.filename}</span>
              <span className="block text-small text-muted">
                {showClient && d.clientId && d.clientName
                  ? <><Link href={`/clients/${d.clientId}`} className="text-brand-ink hover:underline">{d.clientName}</Link> · </>
                  : null}
                <time dateTime={d.createdAt.toISOString()} className="tabular-nums">{fmtDateTime(locale, d.createdAt)}</time>
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
