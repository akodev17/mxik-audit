import Link from 'next/link';
import { billingConfig } from '@tasnivo/domain/billing/config';
import { catalogPaid } from '@tasnivo/domain/billing/orders';
import { db } from '@tasnivo/db';
import { fmtDate } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { degradedNotes, readPipelineMeta } from '@tasnivo/domain/pipeline-meta';
import { Badge } from '@/ui/badge';
import type { CurrentUser } from '@/lib/session';
import { IconInfo } from '@/ui/icons';
import { BillingBox } from './billing-box';
import { ClassifierBanner } from './classifier-banner';
import { ExportActions } from './export-actions';
import { InfoHint } from './info-hint';
import { ReviewField } from './review-field';
import { ShareButton } from './share-button';

type Props = {
  orgId: string;
  catalog: { id: string; clientId?: string | null; filename: string; createdAt: Date; rowCount: number; status: string; previousId?: string | null; snapshotId?: number | null; pipelineMeta?: unknown };
  client: { id: string; name: string };
  /** Only writers may create share links. */
  canShare?: boolean;
  /** Only an admin pays for the corrected file. */
  canPay: boolean;
  /** A demo org never pays. */
  demo: boolean;
  /** When given, a ready catalogue shows its review task for this user. */
  viewer?: CurrentUser;
};

/** Whether the corrected file needs a payment first; shared with the page's completion state. */
export async function exportLocked(orgId: string, catalogId: string): Promise<boolean> {
  return billingConfig().requiredForExport ? !(await catalogPaid(orgId, catalogId)) : false;
}

/**
 * Catalogue name, client, date and the classifier version the audit used
 * (named by its date, with a hint when a newer one exists), any degraded-run
 * notes, and the export actions.
 */
export async function WorkspaceHeader({ orgId, catalog, client, canShare, canPay, demo, viewer }: Props) {
  const { ta, locale } = await getI18n();
  const h = ta.wsX.header;
  const [used, latest, locked] = await Promise.all([
    catalog.snapshotId ? db.catalogSnapshot.findUnique({ where: { id: catalog.snapshotId }, select: { id: true, takenAt: true } }) : null,
    db.catalogSnapshot.findFirst({ orderBy: { id: 'desc' }, select: { id: true, takenAt: true } }),
    exportLocked(orgId, catalog.id),
  ]);
  const newer = used && latest && latest.id > used.id ? latest : null;
  const meta = readPipelineMeta(catalog.pipelineMeta);
  const notes = meta ? degradedNotes(meta, ta) : [];

  const classifier = used
    ? <span>{h.snapshot(fmtDate(locale, used.takenAt))}</span>
    : <><span>{h.snapshotUnknown}</span><InfoHint text={h.snapshotUnknownHint} label={`${ta.ws.classifier}: ${h.more}`} /></>;

  return (
    <header className="border-b border-line px-4 py-3 md:px-5 md:py-4">
      <div className="flex flex-wrap items-start justify-between gap-3 md:gap-4">
        <div className="min-w-0 max-w-full">
          <h1 className="truncate text-section text-fg md:text-title" title={catalog.filename}>{catalog.filename}</h1>
          <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-small">
            <div className="flex min-w-0 gap-1.5"><dt className="text-muted">{ta.ws.client}:</dt><dd className="min-w-0 truncate"><Link href={`/clients/${client.id}`} className="text-brand-ink hover:underline">{client.name}</Link></dd></div>
            <div className="flex gap-1.5"><dt className="text-muted">{ta.ws.date}:</dt><dd>{fmtDate(locale, catalog.createdAt)}</dd></div>
            <div className="flex flex-wrap items-center gap-1.5">
              <dt className="text-muted">{ta.ws.classifier}:</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {classifier}
                {newer ? <Badge tone="info" icon={<IconInfo size={12} />}>{h.newer(fmtDate(locale, newer.takenAt))}</Badge> : null}
              </dd>
            </div>
            {viewer && catalog.status === 'ready' && catalog.clientId ? <ReviewField user={viewer} catalogId={catalog.id} clientId={catalog.clientId} demo={demo} /> : null}
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
          locked={locked}
          share={canShare ? <ShareButton catalogId={catalog.id} /> : null}
          panel={<BillingBox orgId={orgId} catalogId={catalog.id} rowCount={catalog.rowCount} canPay={canPay} demo={demo} />}
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
