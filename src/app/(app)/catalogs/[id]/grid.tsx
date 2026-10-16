'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, type RefObject } from 'react';
import { ta } from '@/lib/i18n-app';
import type { GridRow } from '@/lib/workspace-rows';
import { COLUMNS, MIN_WIDTH } from './columns';
import { entryId, type Entry } from './entries';
import { GridRowView } from './grid-row';
import { GroupRowView } from './group-row';

export type GridHandlers = {
  onSelect: (index: number) => void;
  onAccept: (row: GridRow) => void;
  onReject: (row: GridRow) => void;
  onUndo: (row: GridRow) => void;
  onToggleGroup: (key: string) => void;
  onGroup: (rows: GridRow[], decision: 'accepted' | 'rejected') => void;
  onNeedMore: () => void;
  onCheck: (index: number, shift: boolean) => void;
  onCheckAll: (checked: boolean) => void;
  onEdit: (findingId: string | null) => void;
  onPick: (row: GridRow, code: string, name: string) => void;
};

type Props = {
  entries: Entry[];
  activeIndex: number;
  compact: boolean;
  expanded: ReadonlySet<string>;
  hasMore: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  handlers: GridHandlers;
  readOnly: boolean;
  selected: ReadonlySet<string>;
  allChecked: boolean;
  editingId: string | null;
};

const HEADER_HEIGHT = 40;
const HEIGHT = { comfortable: 60, compact: 38 } as const;
const HEADERS = [ta.ws.colNo, ta.ws.colProduct, ta.ws.colStatus, ta.ws.colCurrent, ta.ws.colSuggested, ta.ws.colConfidence, ta.ws.colDecision];

/** Virtualised spreadsheet grid: only the rows on screen are in the DOM. */
export function Grid({ entries, activeIndex, compact, expanded, hasMore, scrollRef, handlers, readOnly, selected, allChecked, editingId }: Props) {
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
  }, [hasMore, lastIndex, entries.length, handlers.onNeedMore]);

  return (
    <div role="grid" aria-rowcount={entries.length} style={{ minWidth: MIN_WIDTH }}>
      <div
        role="row"
        style={{ gridTemplateColumns: COLUMNS }}
        className="sticky top-0 z-10 grid h-10 items-center border-b border-line-strong bg-surface text-xs font-bold uppercase tracking-wide text-muted"
      >
        <span role="columnheader" className="px-3">
          {readOnly ? null : <input type="checkbox" aria-label={ta.bulk.selectAll} checked={allChecked} onChange={(e) => handlers.onCheckAll(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />}
        </span>
        {HEADERS.map((h) => <span key={h} role="columnheader" className="px-3">{h}</span>)}
      </div>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {items.map((v) => {
          const entry = entries[v.index];
          if (!entry) return null;
          return (
            <div key={v.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: v.size, transform: `translateY(${v.start - HEADER_HEIGHT}px)` }}>
              {entry.kind === 'group' ? (
                <GroupRowView
                  readOnly={readOnly}
                  rows={entry.rows}
                  active={v.index === activeIndex}
                  expanded={expanded.has(entry.key)}
                  onSelect={() => handlers.onSelect(v.index)}
                  onToggle={() => handlers.onToggleGroup(entry.key)}
                  onAccept={() => handlers.onGroup(entry.rows, 'accepted')}
                  onReject={() => handlers.onGroup(entry.rows, 'rejected')}
                />
              ) : (
                <GridRowView
                  readOnly={readOnly}
                  selected={selected.has(entry.row.findingId)}
                  editing={editingId === entry.row.findingId}
                  onCheck={(shift) => handlers.onCheck(v.index, shift)}
                  onEdit={() => handlers.onEdit(entry.row.findingId)}
                  onCancelEdit={() => handlers.onEdit(null)}
                  onPick={(code, name) => handlers.onPick(entry.row, code, name)}
                  row={entry.row}
                  active={v.index === activeIndex}
                  compact={compact}
                  inGroup={entry.inGroup}
                  onSelect={() => handlers.onSelect(v.index)}
                  onAccept={() => handlers.onAccept(entry.row)}
                  onReject={() => handlers.onReject(entry.row)}
                  onUndo={() => handlers.onUndo(entry.row)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
