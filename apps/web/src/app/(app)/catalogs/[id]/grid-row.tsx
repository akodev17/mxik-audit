'use client';

import { memo, type ReactNode } from 'react';
import { useI18n } from '@/lib/locale-client';
import type { GridRow } from './ws-types';
import { Badge } from '@/ui/badge';
import { Checkbox } from '@/ui/checkbox';
import { cx } from '@/ui/cx';
import { IconComment } from '@/ui/icons';
import { typeLabels, typeTone } from '@/ui/labels';
import { CellChip } from './cell-chip';
import { CodeCell } from './code-cell';
import type { ColumnKey, Layout } from './columns';
import { DecisionCell, type DecisionHandlers } from './decision-cell';
import { InlineCodePicker } from './inline-code-picker';
import { MatchChip } from './match-chip';
import { SuggestionCell } from './suggestion-cell';

type Props = DecisionHandlers & {
  row: GridRow;
  /** 1-based position among all grid rows, header included (aria-rowindex). */
  ariaIndex: number;
  domId: string;
  active: boolean;
  compact: boolean;
  inGroup: boolean;
  layout: Layout;
  readOnly: boolean;
  selected: boolean;
  editing: boolean;
  onSelect: () => void;
  onCheck: (shift: boolean) => void;
  onCancelEdit: () => void;
  onChoose: (code: string, name: string) => void;
};

/** The sticky decision cell needs an opaque background matching its row. */
export const rowSurface = (active: boolean, inGroup: boolean): string =>
  active ? 'bg-brand-tint' : inGroup ? 'bg-surface' : 'bg-base group-hover:bg-surface';

/** One finding as a grid row. Memoised: a decision re-renders only its own row. */
export const GridRowView = memo(function GridRowView(p: Props) {
  const { t, ta } = useI18n();
  const { row, compact, readOnly, editing } = p;
  const x = ta.wsX;
  const canEdit = !readOnly && row.decision === 'pending';
  const suggests = row.mode === 'suggest' || (row.decision !== 'pending' && !row.noSuggestion && row.mode !== 'confirm' && row.suggestedMxik !== null);
  const surface = rowSurface(p.active, p.inGroup);

  const cell = (key: ColumnKey): ReactNode => {
    switch (key) {
      case 'select':
        return (
          <span role="gridcell" key={key} className="flex px-2" onClick={(e) => e.stopPropagation()}>
            {readOnly || row.decision !== 'pending' ? null : (
              <Checkbox
                label={`${ta.bulk.selectRow} ${row.rowIndex + 1}`} hideLabel checked={p.selected}
                onChange={() => undefined} onClick={(e) => p.onCheck(e.shiftKey)}
              />
            )}
          </span>
        );
      case 'no':
        return <span role="gridcell" key={key} className="overflow-hidden px-3 text-small tabular-nums text-muted">{row.rowIndex + 1}</span>;
      case 'product':
        return (
          <span role="gridcell" key={key} className="flex min-w-0 flex-col justify-center overflow-hidden px-3">
            <span className={cx('font-medium text-fg', compact ? 'truncate' : 'line-clamp-2 break-words leading-5')} title={row.productName}>{row.productName}</span>
            {compact ? null : (
              <span className="flex min-w-0 items-center gap-2 text-micro text-muted">
                {row.unit ? <span className="truncate">{row.unit}</span> : null}
                {row.marking ? <Badge tone="warn" title={ta.ws.marking_title}>{ta.ws.marking}</Badge> : null}
                {row.comments > 0 ? (
                  <span className="inline-flex items-center gap-1" title={ta.comments.title}>
                    <IconComment /><span className="sr-only">{ta.comments.title}: </span>{row.comments}
                  </span>
                ) : null}
              </span>
            )}
          </span>
        );
      case 'status': {
        const label = typeLabels(t)[row.type] ?? row.type;
        return <span role="gridcell" key={key} className="min-w-0 overflow-hidden px-2"><CellChip tone={typeTone(row.type, row.severity)} label={label} /></span>;
      }
      case 'current':
        return (
          <span role="gridcell" key={key} className="min-w-0 overflow-hidden px-3">
            <CodeCell code={row.currentMxik} name={row.currentName} state={row.currentState} empty={x.noCode} compact={compact} />
          </span>
        );
      case 'suggested':
        return (
          <span
            role="gridcell" key={key}
            className={cx('min-w-0 px-3', editing ? 'overflow-visible' : 'overflow-hidden', canEdit && 'cursor-text')}
            title={canEdit && !editing ? ta.bulk.editHint : undefined}
            onClick={canEdit ? (e) => { e.stopPropagation(); p.onPick(); } : undefined}
          >
            {editing ? <InlineCodePicker onPick={p.onChoose} onCancel={p.onCancelEdit} /> : <SuggestionCell row={row} compact={compact} />}
          </span>
        );
      case 'match':
        return <span role="gridcell" key={key} className="min-w-0 overflow-hidden px-2"><MatchChip confidence={row.confidence} stage={row.stage} show={suggests} short /></span>;
      case 'decision':
        return (
          <span role="gridcell" key={key} className={cx('sticky right-0 flex h-full items-center border-l border-line px-3', surface)}>
            <DecisionCell row={row} readOnly={readOnly} onAccept={p.onAccept} onReject={p.onReject} onPick={p.onPick} onUndo={p.onUndo} />
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div
      role="row"
      id={p.domId}
      aria-rowindex={p.ariaIndex}
      aria-selected={p.active}
      onClick={p.onSelect}
      style={{ gridTemplateColumns: p.layout.template }}
      className={cx(
        'dense group grid h-full cursor-pointer items-center border-b border-line',
        p.active ? 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)]' : p.inGroup ? 'bg-surface' : 'bg-base hover:bg-surface',
      )}
    >
      {p.layout.keys.map(cell)}
    </div>
  );
});
