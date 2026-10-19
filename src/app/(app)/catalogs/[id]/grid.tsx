'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, type RefObject } from 'react';
import { useI18n } from '@/lib/locale-client';
import type { GridRow } from '@/lib/workspace-rows';
import { cx } from '@/ui/cx';
import type { ColumnKey, Layout } from './columns';
import { entryDomId, entryId, type Entry } from './entries';
import { GridRowView } from './grid-row';
import { GroupRowView } from './group-row';

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
};

type Props = {
  entries: Entry[];
  /** Rows the filter has on the server, for aria-rowcount; null when grouping makes it unknown. */
  total: number | null;
  activeIndex: number;
  compact: boolean;
  expanded: ReadonlySet<string>;
  hasMore: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  gridRef: RefObject<HTMLDivElement | null>;
  handlers: GridHandlers;
  readOnly: boolean;
  selected: ReadonlySet<string>;
  allChecked: boolean;
  editingId: string | null;
  layout: Layout;
};

const HEADER_HEIGHT = 40;
const HEIGHT = { comfortable: 64, compact: 40 } as const;

/**
 * Virtualised ARIA grid: only the rows on screen are in the DOM. The grid
 * itself holds focus and points at the active row with aria-activedescendant;
 * the workspace's key handler moves it.
 */
export function Grid({ entries, total, activeIndex, compact, expanded, hasMore, scrollRef, gridRef, handlers, readOnly, selected, allChecked, editingId, layout }: Props) {
  const { ta } = useI18n();
  const c = ta.wsX.col;
  const header: Record<ColumnKey, string> = { select: c.select, no: c.no, product: c.product, status: c.status, current: c.current, suggested: c.suggested, match: c.match, decision: c.decision };
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (compact ? HEIGHT.compact : HEIGHT.comfortable),
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

  const active = entries[activeIndex];
  return (
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
          style={{ gridTemplateColumns: layout.template }}
          className="grid h-10 items-center border-b border-line-strong bg-surface text-small font-medium text-muted"
        >
          {layout.keys.map((k) => (
            <span
              key={k} role="columnheader"
              className={cx('min-w-0 truncate px-3', k === 'select' && 'px-2', k === 'decision' && 'sticky right-0 flex h-full items-center border-l border-line bg-surface')}
            >
              {k === 'select'
                ? (readOnly ? <span className="sr-only">{header.select}</span> : <input type="checkbox" aria-label={ta.bulk.selectAll} checked={allChecked} onChange={(e) => handlers.onCheckAll(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />)
                : header[k]}
            </span>
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
  );
}
