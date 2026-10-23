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
import { ConfidenceMeter } from './confidence-meter';
import { DecisionCell, type DecisionHandlers } from './decision-cell';
import { InlineCodePicker } from './inline-code-picker';
import { showsMatch, SuggestionCell } from './suggestion-cell';

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

/**
 * Row backgrounds: the active row is the grid's one accent (brand tint and a brand edge); a hovered
 * row and a group header take the surface tone. The sticky decision cell repeats its row's background.
 */
export const rowSurface = (active: boolean, header = false): string =>
  active ? 'bg-brand-tint' : header ? 'bg-surface group-hover:bg-sunken' : 'bg-base group-hover:bg-surface';

export const ACTIVE_EDGE = 'shadow-[inset_3px_0_0_var(--color-brand)]';

/** One finding as a grid row, one line high in both densities. Memoised: a decision re-renders only its own row. */
export const GridRowView = memo(function GridRowView(p: Props) {
  const { t, ta } = useI18n();
  const { row, compact, readOnly, editing } = p;
  const x = ta.wsX;
  const canEdit = !readOnly && row.decision === 'pending';
  const decided = row.decision !== 'pending';
  const surface = rowSurface(p.active);

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
        return <span role="gridcell" key={key} className="overflow-hidden px-3 text-right text-small tabular-nums text-muted">{row.rowIndex + 1}</span>;
      case 'product':
        return (
          <span role="gridcell" key={key} className={cx('flex min-w-0 items-center gap-2 overflow-hidden px-3', p.inGroup && 'pl-7')}>
            {p.inGroup ? <span aria-hidden className="absolute inset-y-0 ml-[-0.875rem] w-px bg-line-strong" /> : null}
            <span className={cx('min-w-0 truncate', decided ? 'text-muted' : 'font-medium text-fg')} title={row.productName}>{row.productName}</span>
            {!compact && row.unit ? <span className="shrink-0 text-micro text-muted">{row.unit}</span> : null}
            {row.marking ? <span className="shrink-0"><Badge tone="warn" title={ta.ws.marking_title}>{ta.ws.marking}</Badge></span> : null}
            {row.comments > 0 ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-micro text-muted" title={ta.comments.title}>
                <IconComment /><span className="sr-only">{ta.comments.title}: </span>{row.comments}
              </span>
            ) : null}
          </span>
        );
      case 'status': {
        const label = typeLabels(t)[row.type] ?? row.type;
        return <span role="gridcell" key={key} className="min-w-0 overflow-hidden px-2"><CellChip tone={typeTone(row.type, row.severity)} label={label} /></span>;
      }
      case 'current':
        return (
          <span role="gridcell" key={key} className="min-w-0 overflow-hidden px-3">
            <CodeCell code={row.currentMxik} name={row.currentName} state={row.currentState} empty={x.noCode} compact />
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
            {editing ? <InlineCodePicker onPick={p.onChoose} onCancel={p.onCancelEdit} /> : <SuggestionCell row={row} compact meter={!p.layout.keys.includes('match')} />}
          </span>
        );
      case 'match':
        return <span role="gridcell" key={key} className="min-w-0 overflow-hidden px-2"><ConfidenceMeter confidence={row.confidence} stage={row.stage} show={showsMatch(row)} /></span>;
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
        'dense group relative grid h-full cursor-pointer items-center border-b border-line text-data transition-colors duration-(--duration-fast)',
        p.active ? cx('bg-brand-tint', ACTIVE_EDGE) : 'bg-base hover:bg-surface',
      )}
    >
      {p.layout.keys.map(cell)}
    </div>
  );
});
