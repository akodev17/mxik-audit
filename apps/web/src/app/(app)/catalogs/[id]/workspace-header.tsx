import Link from 'next/link';
import { fmtDate } from '@tasnivo/i18n/format';
import { degradedNotes } from '@/lib/catalogs/report';
import type { CatalogHeader, Me } from '@/lib/catalogs/types';
import { getI18n } from '@/lib/locale';
import { Badge, StatusChip, StatusIcon } from '@/ui/badge';
import { buttonClass } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconBook, IconInfo, IconList } from '@/ui/icons';
import { STATUS_TONE } from '../status-tone';
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
 * The strip above the grid: the catalogue's name with its status, one metadata line (client, date,
 * rows, the classifier version the audit used with a hint when a newer one exists), the review task,
 * links to the report and the version diff, and the export, share and payment actions. Degraded-run
 * notes and the classifier warning sit under it.
 */
export async function WorkspaceHeader({ catalog, user, canShare, showReview }: Props) {
  const { t, ta, locale } = await getI18n();
  const h = ta.wsX.header;
  const f = ta.importX.flow;
  const { usedTakenAt: used, newerTakenAt: newer } = catalog.snapshot;
  const notes = catalog.pipeline ? degradedNotes(catalog.pipeline, ta) : [];
  const tone = STATUS_TONE[catalog.status];
  const ready = catalog.status === 'ready';
  // A middle dot before every item but the first, drawn by CSS so the list stays a plain dl.
  const dot = "before:mr-1 before:text-subtle before:content-['·']";
  const quietLink = buttonClass('ghost', 'compact', 'text-muted hover:text-fg');

  return (
    <header className="border-b border-line bg-base px-4 py-3 md:px-5 md:py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 max-w-full flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="min-w-0 max-w-full truncate text-section text-fg md:text-title" title={catalog.filename}>{catalog.filename}</h1>
            <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>
              {catalog.status === 'uploaded' ? ta.firmX.catalogs.statusUploaded : t.catalogStatus[catalog.status]}
            </StatusChip>
          </div>

          <dl className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted">
            <div className="flex min-w-0 gap-1">
              <dt className="sr-only">{ta.ws.client}</dt>
              <dd className="min-w-0 truncate"><Link href={`/clients/${catalog.client.id}`} className="font-medium text-brand-ink hover:underline">{catalog.client.name}</Link></dd>
            </div>
            <div className={cx('flex gap-1', dot)}><dt className="sr-only">{ta.ws.date}</dt><dd className="tabular-nums">{fmtDate(locale, catalog.createdAt)}</dd></div>
            <div className={cx('flex gap-1', dot)}><dt className="sr-only">{t.catalogsRows}</dt><dd className="tabular-nums">{f.rows(catalog.rowCount)}</dd></div>
            <div className={cx('flex flex-wrap items-center gap-1.5', dot)}>
              <dt>{ta.ws.classifier}:</dt>
              <dd className="flex flex-wrap items-center gap-1.5 text-fg">
                {used
                  ? <span>{h.snapshot(fmtDate(locale, used))}</span>
                  : <><span>{h.snapshotUnknown}</span><InfoHint text={h.snapshotUnknownHint} label={`${ta.ws.classifier}: ${h.more}`} /></>}
                {newer ? <Badge tone="info" icon={<IconInfo size={12} />}>{h.newer(fmtDate(locale, newer))}</Badge> : null}
              </dd>
            </div>
          </dl>
          {newer ? <p className="mt-1 text-micro text-muted">{h.newerHint}</p> : null}

          {ready || catalog.previousId ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              {showReview && ready ? (
                <dl className="flex min-w-0 items-center text-small">
                  <ReviewField user={user} catalogId={catalog.id} demo={catalog.demo} />
                </dl>
              ) : null}
              {ready || catalog.previousId ? (
                <nav aria-label={ta.importX.report.details} className="no-print -ml-2 flex flex-wrap items-center gap-1">
                  {ready ? <Link href={`/catalogs/${catalog.id}/report`} className={quietLink}><IconBook size={14} />{ta.importX.report.title}</Link> : null}
                  {catalog.previousId ? <Link href={`/catalogs/${catalog.id}/diff`} className={quietLink}><IconList size={14} />{ta.diff.title}</Link> : null}
                </nav>
              ) : null}
            </div>
          ) : null}
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
        <section className="mt-3 flex gap-2.5 rounded-md border border-info/40 bg-info-tint px-3.5 py-2.5 text-small text-info-ink" aria-label={ta.matchX.degraded.title}>
          <IconInfo size={16} className="mt-px shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">{ta.matchX.degraded.title}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
            <p className="mt-1 text-micro">{h.degradedMore}</p>
          </div>
        </section>
      ) : null}
    </header>
  );
}
