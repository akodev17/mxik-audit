'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useI18n } from '@/lib/locale-client';
import type { GridRow } from './ws-types';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { cx } from '@/ui/cx';
import { typeLabels, typeTone } from '@/ui/labels';
import { CodeCell } from './code-cell';
import { ACTIVE_EDGE } from './grid-row';
import { DecisionCell } from './decision-cell';
import { ConfidenceMeter } from './confidence-meter';
import { showsMatch, SuggestionCell } from './suggestion-cell';

type Props = {
  rows: GridRow[];
  activeId: string | null;
  hasMore: boolean;
  readOnly: boolean;
  onOpen: (row: GridRow) => void;
  onAccept: (row: GridRow) => void;
  onReject: (row: GridRow) => void;
  onUndo: (row: GridRow) => void;
  onNeedMore: () => void;
};

/**
 * Where the list starts inside the page's one scroll container (the shell's
 * <main>), kept current as the header and toolbar above it change height.
 */
function useListOffset(list: RefObject<HTMLDivElement | null>): [HTMLElement | null, number] {
  const [main, setMain] = useState<HTMLElement | null>(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const el = list.current;
    const scroller = el?.closest('main') ?? null;
    setMain(scroller);
    if (!el || !scroller || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => setOffset(el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop);
    measure();
    const observer = new ResizeObserver(measure);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => observer.disconnect();
  }, [list]);
  return [main, offset];
}

/** Phone layout: one card per finding with name, codes, status and the decision buttons; the page scrolls as one. */
export function CardList({ rows, activeId, hasMore, readOnly, onOpen, onAccept, onReject, onUndo, onNeedMore }: Props) {
  const { t, ta } = useI18n();
  const x = ta.wsX;
  const listRef = useRef<HTMLDivElement | null>(null);
  const [main, offset] = useListOffset(listRef);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => main,
    estimateSize: () => 188,
    overscan: 6,
    scrollMargin: offset,
    getItemKey: (i) => rows[i]?.findingId ?? i,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items[items.length - 1]?.index ?? 0;
  useEffect(() => {
    if (hasMore && lastIndex >= rows.length - 10) onNeedMore();
  }, [hasMore, lastIndex, rows.length, onNeedMore]);

  return (
    <div ref={listRef} role="list" aria-label={x.a11y.cards} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {items.map((v) => {
        const row = rows[v.index];
        if (!row) return null;
        const tone = typeTone(row.type, row.severity);
        return (
          <div
            key={v.key} ref={virtualizer.measureElement} data-index={v.index} role="listitem"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start - offset}px)` }}
            className="px-3 pb-2"
          >
            <article
              onClick={() => onOpen(row)}
              className={cx('space-y-3 rounded-lg border bg-raised p-3', row.findingId === activeId ? cx('border-brand', ACTIVE_EDGE) : 'border-line')}
            >
              <div className="flex items-start justify-between gap-3">
                <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(row); }} className={cx('line-clamp-3 min-w-0 break-words text-left', row.decision === 'pending' ? 'font-medium text-fg' : 'text-muted')}>
                  {row.productName}
                </button>
                <span className="shrink-0 pt-0.5 text-small tabular-nums text-muted">#{row.rowIndex + 1}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{typeLabels(t)[row.type] ?? row.type}</StatusChip>
                {row.unit ? <span className="text-micro text-muted">{row.unit}</span> : null}
              </div>
              <dl className="grid grid-cols-1 gap-2 rounded-md bg-surface p-2.5 min-[420px]:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-micro text-muted">{x.col.current}</dt>
                  <dd><CodeCell code={row.currentMxik} name={row.currentName} state={row.currentState} empty={x.noCode} compact={false} /></dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-micro text-muted">{x.col.suggested}</dt>
                  <dd><SuggestionCell row={row} compact={false} /></dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ConfidenceMeter confidence={row.confidence} stage={row.stage} show={showsMatch(row)} />
                <DecisionCell
                  row={row} readOnly={readOnly} size="sm"
                  onAccept={() => onAccept(row)} onReject={() => onReject(row)} onPick={() => onOpen(row)} onUndo={() => onUndo(row)}
                />
              </div>
            </article>
          </div>
        );
      })}
    </div>
  );
}
