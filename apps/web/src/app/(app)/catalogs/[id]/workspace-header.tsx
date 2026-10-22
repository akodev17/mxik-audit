import Link from 'next/link';
import { fmtDate } from '@tasnivo/i18n/format';
import { degradedNotes } from '@/lib/catalogs/report';
import type { CatalogHeader, Me } from '@/lib/catalogs/types';
import { getI18n } from '@/lib/locale';
import { Badge } from '@/ui/badge';
import { IconInfo } from '@/ui/icons';
import { BillingBox } from './billing-box';
import { ClassifierBanner } from './classifier-banner';
import { ExportActions } from './export-actions';
import { InfoHint } from './info-hint';
import { ReviewField } from './review-field';
import { ShareButton } from './share-button';

type Props = {
  /** The catalogue as the API's header read answers it (catalogs.get). */
  catalog: CatalogHeader;
  user: Me;
  /** Only writers may create share links. */
  canShare?: boolean;
  /** A ready catalogue shows its review task for this user. */
  showReview?: boolean;
};

/**
 * Catalogue name, client, date and the classifier version the audit used
 * (named by its date, with a hint when a newer one exists), any degraded-run
 * notes, and the export actions.
 */
export async function WorkspaceHeader({ catalog, user, canShare, showReview }: Props) {
  const { ta, locale } = await getI18n();
  const h = ta.wsX.header;
  const { usedTakenAt: used, newerTakenAt: newer } = catalog.snapshot;
  const notes = catalog.pipeline ? degradedNotes(catalog.pipeline, ta) : [];
  const classifier = used
    ? <span>{h.snapshot(fmtDate(locale, used))}</span>
    : <><span>{h.snapshotUnknown}</span><InfoHint text={h.snapshotUnknownHint} label={`${ta.ws.classifier}: ${h.more}`} /></>;

  return (
    <header className="border-b border-line px-4 py-3 md:px-5 md:py-4">
      <div className="flex flex-wrap items-start justify-between gap-3 md:gap-4">
        <div className="min-w-0 max-w-full">
          <h1 className="truncate text-section text-fg md:text-title" title={catalog.filename}>{catalog.filename}</h1>
          <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-small">
            <div className="flex min-w-0 gap-1.5"><dt className="text-muted">{ta.ws.client}:</dt><dd className="min-w-0 truncate"><Link href={`/clients/${catalog.client.id}`} className="text-brand-ink hover:underline">{catalog.client.name}</Link></dd></div>
            <div className="flex gap-1.5"><dt className="text-muted">{ta.ws.date}:</dt><dd>{fmtDate(locale, catalog.createdAt)}</dd></div>
            <div className="flex flex-wrap items-center gap-1.5">
              <dt className="text-muted">{ta.ws.classifier}:</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {classifier}
                {newer ? <Badge tone="info" icon={<IconInfo size={12} />}>{h.newer(fmtDate(locale, newer))}</Badge> : null}
              </dd>
            </div>
            {showReview && catalog.status === 'ready' ? <ReviewField user={user} catalogId={catalog.id} demo={catalog.demo} /> : null}
            {catalog.status === 'ready' ? (
              <div className="flex gap-1.5"><dt className="text-muted">{ta.importX.report.details}:</dt><dd><Link href={`/catalogs/${catalog.id}/report`} className="text-brand-ink hover:underline">{ta.importX.report.title}</Link></dd></div>
            ) : null}
            {catalog.previousId ? (
              <div className="flex gap-1.5"><dt className="text-muted">{ta.diff.versions}:</dt><dd><Link href={`/catalogs/${catalog.id}/diff`} className="text-brand-ink hover:underline">{ta.diff.title}</Link></dd></div>
            ) : null}
          </dl>
          {newer ? <p className="mt-1 text-micro text-muted">{h.newerHint}</p> : null}
        </div>
        <ExportActions
          catalogId={catalog.id}
          status={catalog.status}
          locked={catalog.exportLocked}
          share={canShare ? <ShareButton catalogId={catalog.id} /> : null}
          panel={catalog.exportLocked ? <BillingBox catalogId={catalog.id} rowCount={catalog.rowCount} /> : null}
        />
      </div>
      <ClassifierBanner className="mt-3" />
      {notes.length > 0 ? (
        <section className="mt-3 rounded-ctl border border-line bg-info-tint px-3 py-2 text-small text-info-ink" aria-label={ta.matchX.degraded.title}>
          <p className="flex items-center gap-1.5 font-medium"><IconInfo size={14} />{ta.matchX.degraded.title}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
          <p className="mt-1 text-micro">{h.degradedMore}</p>
        </section>
      ) : null}
    </header>
  );
}
