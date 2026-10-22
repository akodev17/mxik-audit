'use client';

import type { ReactNode } from 'react';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import type { GridRow } from '@tasnivo/domain/workspace-rows';
import { Button } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconChevron } from '@/ui/icons';
import { typeLabels, typeTone } from '@/ui/labels';
import { CellChip } from './cell-chip';
import { CodeCell } from './code-cell';
import type { ColumnKey, Layout } from './columns';
import { rowSurface } from './grid-row';
import { count } from './ws-text';

type Props = {
  rows: GridRow[];
  ariaIndex: number;
  domId: string;
  active: boolean;
  expanded: boolean;
  compact: boolean;
  layout: Layout;
  onSelect: () => void;
  onToggle: () => void;
  onAccept: () => void;
  onReject: () => void;
  readOnly: boolean;
};

/**
 * Header of a group of similar loaded rows (same name, check and suggestion): one decision,
 * one audit event and one undo for every pending member. Laid out on the grid's own columns.
 */
export function GroupRowView({ rows, ariaIndex, domId, active, expanded, compact, layout, onSelect, onToggle, onAccept, onReject, readOnly }: Props) {
  const { t, ta, locale } = useI18n();
  const g = ta.wsX.group;
  const first = rows[0];
  const pending = rows.filter((r) => r.decision === 'pending').length;
  const progress = pending > 0 ? g.pendingOf(fmtNumber(locale, pending), fmtNumber(locale, rows.length)) : g.done;
  const sameCurrent = first && rows.every((r) => r.currentMxik === first.currentMxik) ? first : null;

  const cell = (key: ColumnKey): ReactNode => {
    switch (key) {
      case 'select':
        return <span role="gridcell" key={key} />;
      case 'no':
        return (
          <span role="gridcell" key={key} className="px-2">
            <button
              type="button" aria-expanded={expanded} aria-label={expanded ? g.collapse : g.expand}
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              className={cx('grid size-7 place-items-center rounded-sm text-muted hover:bg-sunken hover:text-fg transition-transform duration-(--duration-fast)', expanded && 'rotate-90')}
            >
              <IconChevron size={16} />
            </button>
          </span>
        );
      case 'product':
        return (
          <span role="gridcell" key={key} className="flex min-w-0 flex-col justify-center overflow-hidden px-3">
            <span className="truncate font-medium text-fg" title={first?.productName}>{first?.productName}</span>
            <span className="truncate text-micro text-muted">{count(locale, g.rows, rows.length)} · {progress}</span>
          </span>
        );
      case 'status':
        return first ? (
          <span role="gridcell" key={key} className="min-w-0 overflow-hidden px-2">
            <CellChip tone={typeTone(first.type, first.severity)} label={typeLabels(t)[first.type] ?? first.type} />
          </span>
        ) : <span role="gridcell" key={key} />;
      case 'current':
        return (
          <span role="gridcell" key={key} className="min-w-0 overflow-hidden px-3">
            {sameCurrent ? <CodeCell code={sameCurrent.currentMxik} name={sameCurrent.currentName} state={sameCurrent.currentState} empty={ta.wsX.noCode} compact={compact} /> : null}
          </span>
        );
      case 'suggested':
        return (
          <span role="gridcell" key={key} className="min-w-0 overflow-hidden px-3">
            {first?.suggestedMxik ? <CodeCell code={first.suggestedMxik} name={first.suggestedName} empty="—" compact={compact} /> : null}
          </span>
        );
      case 'match':
        return <span role="gridcell" key={key} />;
      case 'decision':
        return (
          <span role="gridcell" key={key} className={cx('sticky right-0 flex h-full items-center gap-1.5 border-l border-line px-3', active ? 'bg-brand-tint' : rowSurface(false, true))} onClick={(e) => e.stopPropagation()}>
            {readOnly ? null : (
              <>
                <Button size="compact" variant="secondary" disabled={pending === 0} onClick={onAccept} aria-label={g.accept} title={g.accept}>{ta.wsX.act.accept}</Button>
                <Button size="compact" variant="ghost" disabled={pending === 0} onClick={onReject} aria-label={g.reject} title={g.reject}>{ta.wsX.act.reject}</Button>
              </>
            )}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div
      role="row" id={domId} aria-rowindex={ariaIndex} aria-selected={active} aria-expanded={expanded}
      onClick={onSelect}
      style={{ gridTemplateColumns: layout.template }}
      className={cx('dense group grid h-full cursor-pointer items-center border-b border-line', active ? 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)]' : 'bg-surface hover:bg-sunken')}
    >
      {layout.keys.map(cell)}
    </div>
  );
}
