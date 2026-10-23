'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, type ReactNode, type RefObject } from 'react';
import { useI18n } from '@/lib/locale-client';
import type { GridRow } from './ws-types';
import { Checkbox } from '@/ui/checkbox';
import { cx } from '@/ui/cx';
import { IconChevronDown } from '@/ui/icons';
import { Skeleton } from '@/ui/skeleton';
import { cellPad, HEADER_HEIGHT, ROW_HEIGHT, type ColumnKey, type Layout } from './columns';
import { entryDomId, entryId, type Entry } from './entries';
import { GridRowView } from './grid-row';
import { GroupRowView } from './group-row';
import { count } from './ws-text';

export type GridHandlers = {
  onSelect: (index: number) => void;
  onAccept: (row: GridRow) => void;
  onReject: (row: GridRow) => void;
  onPick: (row: GridRow) => void;
  onUndo: (row: GridRow) => void;
  onToggleGroup: (key: string) => void;
  onGroup: (rows: GridRow[], decision: 'accepted' | 'rejected') => void;
  onNeedMore: () => void;
  onCheck: (index: number, shift: boolean) => void;
  onCheckAll: (checked: boolean) => void;
  onCancelEdit: () => void;
  onChoose: (row: GridRow, code: string, name: string) => void;
  onSort: (sort: 'risk' | 'row') => void;
};

type Props = {
  entries: Entry[];
  /** Rows the filter has on the server, for aria-rowcount; null when grouping makes it unknown. */
  total: number | null;
  /** Findings the filter has (the "end of list" line). */
  found: number;
  activeIndex: number;
  compact: boolean;
  expanded: ReadonlySet<string>;
  hasMore: boolean;
  /** Every row of the filter is loaded: the list ends with a line that says so. */
  ended: boolean;
  sort: 'risk' | 'row';
  scrollEl: HTMLDivElement | null;
  gridRef: RefObject<HTMLDivElement | null>;
  handlers: GridHandlers;
  readOnly: boolean;
  selected: ReadonlySet<string>;
  allChecked: boolean;
  editingId: string | null;
  layout: Layout;
};

/** Placeholder rows on the grid's own columns, the height of real ones, so nothing shifts when they arrive. */
export function SkeletonRows({ layout, compact, rows = 3 }: { layout: Layout; compact: boolean; rows?: number }) {
  const width: Partial<Record<ColumnKey, string>> = { no: 'ml-auto w-6', product: 'w-3/4', status: 'w-24', current: 'w-32', suggested: 'w-32', match: 'w-16', decision: 'w-40' };
  return (
    <div aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ gridTemplateColumns: layout.template, height: compact ? ROW_HEIGHT.compact : ROW_HEIGHT.comfortable, minWidth: layout.minWidth }} className="grid items-center border-b border-line">
          {layout.keys.map((k) => (
            <span key={k} className={cx('min-w-0', cellPad(k))}>
              {k === 'select' ? null : <Skeleton className={cx('h-3', width[k] ?? 'w-full')} />}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Virtualised ARIA grid: only the rows on screen are in the DOM. The grid
 * itself holds focus and points at the active row with aria-activedescendant;
 * the workspace's key handler moves it.
 */
export function Grid({ entries, total, found, activeIndex, compact, expanded, hasMore, ended, sort, scrollEl, gridRef, handlers, readOnly, selected, allChecked, editingId, layout }: Props) {
  const { ta, locale } = useI18n();
  const c = ta.wsX.col;
  const s = ta.wsUi.sort;
  const header: Record<ColumnKey, string> = { select: c.select, no: c.no, product: c.product, status: c.status, current: c.current, suggested: c.suggested, match: c.match, decision: c.decision };
  const height = compact ? ROW_HEIGHT.compact : ROW_HEIGHT.comfortable;
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => height,
    overscan: 12,
    scrollMargin: HEADER_HEIGHT,
    getItemKey: (i) => (entries[i] ? entryId(entries[i]) : i),
  });

  // The density toggle changes every row height.
  useEffect(() => { virtualizer.measure(); }, [compact, virtualizer]);

  useEffect(() => {
    if (activeIndex >= 0) virtualizer.scrollToIndex(activeIndex, { align: 'auto' });
  }, [activeIndex, virtualizer]);

  const items = virtualizer.getVirtualItems();
  const lastIndex = items[items.length - 1]?.index ?? 0;
  useEffect(() => {
    if (hasMore && lastIndex >= entries.length - 25) handlers.onNeedMore();
  }, [hasMore, lastIndex, entries.length, handlers]);

  // Sorting exists for two orders: risk (the default, by the problem column) and file order (by #).
  const sortable: Partial<Record<ColumnKey, { value: 'risk' | 'row'; label: string; dir: 'ascending' | 'descending' }>> = {
    no: { value: 'row', label: s.byRow, dir: 'ascending' },
    status: { value: 'risk', label: s.byRisk, dir: 'descending' },
  };
  const headCell = (k: ColumnKey): ReactNode => {
    const sorter = sortable[k];
    if (!sorter) return header[k];
    const on = sort === sorter.value;
    return (
      <button
        type="button" title={sorter.label} aria-label={`${header[k]}: ${sorter.label}`} aria-pressed={on}
        onClick={() => { if (!on) handlers.onSort(sorter.value); }}
        className={cx('-mx-1.5 inline-flex h-7 max-w-full items-center gap-1 rounded-sm px-1.5 hover:bg-sunken hover:text-fg', on && 'text-fg', k === 'no' && 'ml-auto')}
      >
        <span className="truncate">{header[k]}</span>
        <IconChevronDown size={12} className={cx('shrink-0 transition-opacity', on ? 'opacity-100' : 'opacity-0 group-hover/head:opacity-60', sorter.dir === 'ascending' && 'rotate-180')} />
      </button>
    );
  };

  const active = entries[activeIndex];
  return (
    <>
      <div
        ref={gridRef}
        role="grid"
        tabIndex={0}
        aria-label={ta.wsX.a11y.grid}
        aria-rowcount={total === null ? -1 : total + 1}
        aria-colcount={layout.keys.length}
        aria-activedescendant={active ? entryDomId(active) : undefined}
        style={{ minWidth: layout.minWidth }}
        className="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <div role="rowgroup" className="sticky top-0 z-sticky">
          <div
            role="row" aria-rowindex={1}
            style={{ gridTemplateColumns: layout.template, height: HEADER_HEIGHT }}
            className="group/head grid items-center border-b border-line-strong bg-surface text-small font-medium text-muted"
          >
            {layout.keys.map((k) => (
              k === 'select' ? (
                <span key={k} role="columnheader" className="relative flex px-2">
                  {readOnly ? <span className="sr-only">{header.select}</span> : (
                    <Checkbox label={ta.bulk.selectAll} hideLabel checked={allChecked} onChange={(e) => handlers.onCheckAll(e.target.checked)} />
                  )}
                </span>
              ) : (
                <span
                  key={k} role="columnheader"
                  aria-sort={sortable[k] ? (sort === sortable[k]?.value ? sortable[k]?.dir : 'none') : undefined}
                  className={cx(
                    'flex min-w-0 items-center truncate', cellPad(k),
                    k === 'no' && 'justify-end',
                    k === 'decision' && 'sticky right-0 h-full border-l border-line bg-surface',
                  )}
                >
                  {headCell(k)}
                </span>
              )
            ))}
          </div>
        </div>
        <div role="rowgroup" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((v) => {
            const entry = entries[v.index];
            if (!entry) return null;
            const common = { ariaIndex: v.index + 2, domId: entryDomId(entry), active: v.index === activeIndex, layout, readOnly };
            return (
              <div key={v.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: v.size, transform: `translateY(${v.start - HEADER_HEIGHT}px)` }}>
                {entry.kind === 'group' ? (
                  <GroupRowView
                    {...common}
                    rows={entry.rows}
                    expanded={expanded.has(entry.key)}
                    compact={compact}
                    onSelect={() => handlers.onSelect(v.index)}
                    onToggle={() => handlers.onToggleGroup(entry.key)}
                    onAccept={() => handlers.onGroup(entry.rows, 'accepted')}
                    onReject={() => handlers.onGroup(entry.rows, 'rejected')}
                  />
                ) : (
                  <GridRowView
                    {...common}
                    row={entry.row}
                    compact={compact}
                    inGroup={entry.inGroup}
                    selected={selected.has(entry.row.findingId)}
                    editing={editingId === entry.row.findingId}
                    onSelect={() => handlers.onSelect(v.index)}
                    onCheck={(shift) => handlers.onCheck(v.index, shift)}
                    onAccept={() => handlers.onAccept(entry.row)}
                    onReject={() => handlers.onReject(entry.row)}
                    onPick={() => handlers.onPick(entry.row)}
                    onUndo={() => handlers.onUndo(entry.row)}
                    onCancelEdit={handlers.onCancelEdit}
                    onChoose={(code, name) => handlers.onChoose(entry.row, code, name)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* More rows wait on the server: placeholders stand where they will appear (loading starts 25 rows before the end). */}
      {hasMore ? <SkeletonRows layout={layout} compact={compact} /> : null}
      {ended && entries.length > 0 ? (
        <p style={{ minWidth: layout.minWidth }} className="flex h-12 items-center gap-3 px-4 text-small text-muted">
          <span aria-hidden className="h-px w-8 bg-line-strong" />
          {count(locale, ta.wsUi.list.end, found)}
          <span aria-hidden className="h-px w-8 bg-line-strong" />
        </p>
      ) : null}
    </>
  );
}
