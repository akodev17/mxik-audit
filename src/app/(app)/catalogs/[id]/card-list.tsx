'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, type RefObject } from 'react';
import { useI18n } from '@/lib/locale-client';
import type { GridRow } from '@/lib/workspace-rows';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { cx } from '@/ui/cx';
import { typeLabels, typeTone } from '@/ui/labels';
import { CodeCell } from './code-cell';
import { DecisionCell } from './decision-cell';
import { MatchChip } from './match-chip';
import { SuggestionCell } from './suggestion-cell';

type Props = {
  rows: GridRow[];
  activeId: string | null;
  hasMore: boolean;
  readOnly: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onOpen: (row: GridRow) => void;
  onAccept: (row: GridRow) => void;
  onReject: (row: GridRow) => void;
  onUndo: (row: GridRow) => void;
  onNeedMore: () => void;
};

/** Phone layout: one card per finding with name, codes, status and the decision buttons. */
export function CardList({ rows, activeId, hasMore, readOnly, scrollRef, onOpen, onAccept, onReject, onUndo, onNeedMore }: Props) {
  const { t, ta } = useI18n();
  const x = ta.wsX;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 188,
    overscan: 6,
    getItemKey: (i) => rows[i]?.findingId ?? i,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items[items.length - 1]?.index ?? 0;
  useEffect(() => {
    if (hasMore && lastIndex >= rows.length - 10) onNeedMore();
  }, [hasMore, lastIndex, rows.length, onNeedMore]);

  return (
    <div role="list" aria-label={x.a11y.cards} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {items.map((v) => {
        const row = rows[v.index];
        if (!row) return null;
        const tone = typeTone(row.type, row.severity);
        const suggests = row.mode === 'suggest' || (row.decision !== 'pending' && !row.noSuggestion && row.mode !== 'confirm' && row.suggestedMxik !== null);
        return (
          <div
            key={v.key} ref={virtualizer.measureElement} data-index={v.index} role="listitem"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }}
            className="px-3 pb-2"
          >
            <article
              onClick={() => onOpen(row)}
              className={cx('space-y-2 rounded-lg border bg-raised p-3', row.findingId === activeId ? 'border-brand' : 'border-line')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-small tabular-nums text-muted">#{row.rowIndex + 1}</span>
                <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{typeLabels(t)[row.type] ?? row.type}</StatusChip>
              </div>
              <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(row); }} className="line-clamp-3 w-full break-words text-left font-medium text-fg">
                {row.productName}
              </button>
              <dl className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
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
                <MatchChip confidence={row.confidence} stage={row.stage} show={suggests} />
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
