import Link from 'next/link';
import type { CatalogListItem } from '@/lib/catalogs';
import { fmtDateTime, fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { Badge, StatusChip, StatusIcon, type Tone } from '@/ui/badge';
import { cx } from '@/ui/cx';
import { CatalogRowActions } from './catalog-row-actions';

const STATUS_TONE: Record<CatalogListItem['status'], Tone> = { ready: 'good', analyzing: 'info', failed: 'danger', uploaded: 'neutral' };

type Props = { items: CatalogListItem[]; showClient: boolean; canDelete: boolean };

/**
 * Catalogues as a list that reads as a table on wide screens and as cards on a
 * phone. Not a <table>: the row menu must not be clipped by a scroll frame.
 */
export async function CatalogList({ items, showClient, canDelete }: Props) {
  const { locale, t, ta } = await getI18n();
  const words = ta.firmX.catalogs;
  const cols = showClient
    ? 'md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_5rem_5rem_8.5rem_7.5rem]'
    : 'md:grid-cols-[minmax(0,2.4fr)_minmax(0,1.6fr)_5rem_5rem_8.5rem_7.5rem]';
  const label = 'text-micro text-muted md:sr-only';
  return (
    <div className="relative rounded-ctl border border-line bg-raised">
      <div aria-hidden className={cx('hidden gap-3 border-b border-line-strong bg-surface px-3 py-2 text-small font-medium text-muted md:grid', cols)}>
        <span>{words.colFile}</span>
        {showClient ? <span>{words.client}</span> : null}
        <span>{words.colUploaded}</span>
        <span className="text-right">{t.catalogsRows}</span>
        <span className="text-right">{t.catalogsRisky}</span>
        <span>{t.catalogsStatus}</span>
        <span />
      </div>
      <ul className="divide-y divide-line">
        {items.map((c) => {
          const tone = STATUS_TONE[c.status];
          return (
            <li key={c.id} className={cx('relative grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-3 md:items-center md:py-2', cols)}>
              <div className="col-span-2 min-w-0 md:col-span-1">
                <Link href={`/catalogs/${c.id}`} className="block truncate font-medium hover:text-brand-ink hover:underline" title={c.filename}>{c.filename}</Link>
                {c.repeatedName ? <Badge tone="neutral" title={words.repeatedHint} className="mt-0.5">{words.repeated}</Badge> : null}
              </div>
              {showClient ? (
                <div className="col-span-2 min-w-0 md:col-span-1">
                  <span className={label}>{words.client}</span>
                  {c.clientId && c.clientName
                    ? <Link href={`/clients/${c.clientId}`} className="block truncate text-small text-brand-ink hover:underline">{c.clientName}</Link>
                    : <span className="text-small text-muted">{ta.firmX.dash}</span>}
                </div>
              ) : null}
              <div className="col-span-2 min-w-0 text-small md:col-span-1">
                <span className={label}>{words.colUploaded}</span>
                <time dateTime={c.createdAt.toISOString()} className="block tabular-nums">{fmtDateTime(locale, c.createdAt)}</time>
                <span className="block truncate text-muted" title={c.uploader ?? undefined}>
                  {c.uploader ?? words.uploaderUnknown}{c.viaTelegram ? ` · ${words.viaTelegram}` : ''}
                </span>
              </div>
              <div className="text-small md:text-right">
                <span className={label}>{t.catalogsRows}</span>
                <span className="block tabular-nums">{fmtNumber(locale, c.rowCount)}</span>
              </div>
              <div className="text-small md:text-right">
                <span className={label}>{t.catalogsRisky}</span>
                {c.riskyRows === null
                  ? <span className="block text-muted"><span aria-hidden>{ta.firmX.dash}</span><span className="sr-only">{words.notAudited}</span></span>
                  : <span className={cx('block tabular-nums', c.riskyRows > 0 && 'font-medium text-danger-ink')}>{fmtNumber(locale, c.riskyRows)}</span>}
              </div>
              <div>
                <span className={label}>{t.catalogsStatus}</span>
                <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{c.status === 'uploaded' ? words.statusUploaded : t.catalogStatus[c.status]}</StatusChip>
              </div>
              <div className="col-span-2 md:col-span-1">
                <CatalogRowActions catalogId={c.id} filename={c.filename} clientName={c.clientName} rowCount={c.rowCount} canDelete={canDelete} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
