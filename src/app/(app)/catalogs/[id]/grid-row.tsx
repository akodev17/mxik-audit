'use client';

import { memo } from 'react';
import { ta } from '@/lib/i18n-app';
import type { GridRow } from '@/lib/workspace-rows';
import { Badge, StatusChip } from '@/ui/badge';
import { Button } from '@/ui/button';
import { confidenceView, TYPE_LABEL, typeTone } from '@/ui/labels';
import { CodeCell } from './code-cell';
import { COLUMNS } from './columns';

type Props = {
  row: GridRow;
  active: boolean;
  compact: boolean;
  inGroup: boolean;
  onSelect: () => void;
  onAccept: () => void;
  onReject: () => void;
  onUndo: () => void;
};

function Decision({ row, onAccept, onReject, onUndo, onSelect }: Pick<Props, 'row' | 'onAccept' | 'onReject' | 'onUndo' | 'onSelect'>) {
  if (row.decision === 'pending') {
    return (
      <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {row.noSuggestion || !row.suggestedMxik ? (
          <Button size="sm" variant="secondary" onClick={onSelect}>Kod tanlash</Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={onAccept}>{ta.ws.accept}</Button>
        )}
        <Button size="sm" variant="ghost" onClick={onReject}>{ta.ws.reject}</Button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <StatusChip tone={row.decision === 'accepted' ? 'good' : 'neutral'}>
        {row.decision === 'accepted' ? ta.ws.accepted : ta.ws.rejected}
      </StatusChip>
      <button type="button" onClick={onUndo} className="text-sm text-brand hover:underline">{ta.ws.undo}</button>
    </span>
  );
}

/** One finding as a grid row. Memoised: a decision re-renders only its own row. */
export const GridRowView = memo(function GridRowView({ row, active, compact, inGroup, onSelect, onAccept, onReject, onUndo }: Props) {
  const conf = confidenceView(row.confidence, row.barcode);
  const shownCode = row.chosenMxik ?? row.suggestedMxik;
  const shownName = row.chosenMxik ? row.chosenName : row.suggestedName;
  return (
    <div
      role="row"
      aria-selected={active}
      onClick={onSelect}
      style={{ gridTemplateColumns: COLUMNS }}
      className={`dense grid h-full cursor-pointer items-center border-b border-line ${active ? 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)]' : inGroup ? 'bg-surface/60 hover:bg-surface' : 'hover:bg-surface/70'}`}
    >
      <span className="px-3 text-sm text-muted">{row.rowIndex + 1}</span>
      <span className="flex min-w-0 flex-col justify-center px-3">
        <span className="truncate font-medium" title={row.productName}>{row.productName}</span>
        {compact ? null : (
          <span className="flex items-center gap-2 text-xs text-muted">
            {row.unit ? <span>{row.unit}</span> : null}
            {row.marking ? <Badge tone="warn" title={ta.ws.marking_title}>{ta.ws.marking}</Badge> : null}
          </span>
        )}
      </span>
      <span className="px-3"><StatusChip tone={typeTone(row.type, row.severity)}>{TYPE_LABEL[row.type] ?? row.type}</StatusChip></span>
      <span className="min-w-0 px-3">
        <CodeCell code={row.currentMxik} name={row.currentName} state={row.currentState} empty={ta.ws.noCode} compact={compact} />
      </span>
      <span className="min-w-0 px-3">
        {row.noSuggestion && !row.chosenMxik
          ? <span className="block truncate text-sm italic text-muted" title={ta.ws.noSuggestion}>{ta.ws.noSuggestion}</span>
          : <CodeCell code={shownCode} name={shownName} empty="—" compact={compact} />}
      </span>
      <span className="px-3">
        {conf && !row.noSuggestion ? <StatusChip tone={conf.tone} title={`${conf.percent}%`}>{conf.label}</StatusChip> : <span className="text-muted">—</span>}
      </span>
      <span className="px-3"><Decision row={row} onAccept={onAccept} onReject={onReject} onUndo={onUndo} onSelect={onSelect} /></span>
    </div>
  );
});
