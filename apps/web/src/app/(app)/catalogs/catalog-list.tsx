'use client';

import Link from 'next/link';
import type { CatalogListItem } from '@/lib/catalogs/types';
import { fmtDateTime, fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { Badge, StatusChip, StatusIcon } from '@/ui/badge';
import { cx } from '@/ui/cx';
import { IconTable } from '@/ui/icons';
import { Tooltip } from '@/ui/tooltip';
import { CatalogRowActions } from './catalog-row-actions';
import { STATUS_TONE } from './status-tone';

/** The API's rows (ISO dates); a page still reading the domain passes Dates until it moves too. */
export type ListedCatalog = Omit<CatalogListItem, 'createdAt'> & { createdAt: string | Date };

type Props = {
  items: ListedCatalog[];
  showClient: boolean;
  canDelete: boolean;
  /** Re-render the server page after a deletion; off where the list is a React Query read (it is invalidated). */
  refreshAfterDelete?: boolean;
};

/**
 * Catalogues as a list that reads as a table on wide screens (sticky header, hover rows, row
 * actions shown on hover or focus) and as cards on a phone. Not a <table>: the row menu must not
 * be clipped by a scroll frame.
 */
export function CatalogList({ items, showClient, canDelete, refreshAfterDelete = true }: Props) {
  const { locale, t, ta } = useI18n();
  const words = ta.firmX.catalogs;
  const cols = showClient
    ? 'md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_4.5rem_5rem_minmax(8.5rem,auto)_7.5rem]'
    : 'md:grid-cols-[minmax(0,2.4fr)_minmax(0,1.6fr)_4.5rem_5rem_minmax(8.5rem,auto)_7.5rem]';
  const label = 'text-micro text-muted md:sr-only';
  return (
    <div className="relative rounded-lg border border-line bg-raised">
      <div aria-hidden className={cx('sticky top-0 z-sticky hidden gap-3 rounded-t-lg border-b border-line-strong bg-surface px-4 py-2 text-small font-medium text-muted md:grid', cols)}>
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
            <li
              key={c.id}
              className={cx(
                'group relative grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 transition-colors duration-(--duration-fast) last:rounded-b-lg hover:bg-surface focus-within:bg-surface md:min-h-14 md:items-center md:py-2',
                cols,
              )}
            >
              <div className="col-span-2 flex min-w-0 items-center gap-3 md:col-span-1">
                <span aria-hidden className="hidden size-8 shrink-0 place-items-center rounded-md bg-sunken text-muted sm:grid"><IconTable size={16} /></span>
                <div className="min-w-0">
                  <Link href={`/catalogs/${c.id}`} className="block truncate font-medium text-fg hover:text-brand-ink hover:underline" title={c.filename}>{c.filename}</Link>
                  {/* Focusable, so touch and keyboard users can reach the explanation too. */}
                  {c.repeatedName ? (
                    <Tooltip content={words.repeatedHint} align="start">
                      <button type="button" className="mt-0.5 rounded-sm"><Badge tone="neutral">{words.repeated}</Badge></button>
                    </Tooltip>
                  ) : null}
                </div>
              </div>
              {showClient ? (
                <div className="col-span-2 min-w-0 md:col-span-1">
                  <span className={label}>{words.client}</span>
                  {c.clientId && c.clientName
                    ? <Link href={`/clients/${c.clientId}`} className="block truncate text-small text-brand-ink hover:underline" title={c.clientName}>{c.clientName}</Link>
                    : <span className="text-small text-muted">{ta.firmX.dash}</span>}
                </div>
              ) : null}
              <div className="col-span-2 min-w-0 text-small md:col-span-1">
                <span className={label}>{words.colUploaded}</span>
                <time dateTime={new Date(c.createdAt).toISOString()} className="block tabular-nums text-fg">{fmtDateTime(locale, c.createdAt)}</time>
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
                  : c.riskyRows > 0
                    ? <span className="block"><Badge tone="danger" className="tabular-nums">{fmtNumber(locale, c.riskyRows)}</Badge></span>
                    : <span className="block tabular-nums text-muted">0</span>}
              </div>
              <div className="col-span-2 min-w-0 md:col-span-1 md:pr-2">
                <span className={label}>{t.catalogsStatus}</span>
                <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{c.status === 'uploaded' ? words.statusUploaded : t.catalogStatus[c.status]}</StatusChip>
              </div>
              {/* On a pointer screen the actions appear with the row's hover or focus; touch screens always show them. */}
              <div className="col-span-2 transition-opacity duration-(--duration-fast) md:col-span-1 md:pointer-fine:opacity-0 md:pointer-fine:group-hover:opacity-100 md:pointer-fine:group-focus-within:opacity-100">
                <CatalogRowActions catalogId={c.id} filename={c.filename} clientName={c.clientName} rowCount={c.rowCount} canDelete={canDelete} refreshAfterDelete={refreshAfterDelete} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
