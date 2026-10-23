'use client';

import type { ReactNode } from 'react';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import type { GridRow } from './ws-types';
import { Button } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconChevron } from '@/ui/icons';
import { typeLabels, typeTone } from '@/ui/labels';
import { CellChip } from './cell-chip';
import { CodeCell } from './code-cell';
import type { ColumnKey, Layout } from './columns';
import { ACTIVE_EDGE, rowSurface } from './grid-row';
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
 * one audit event and one undo for every pending member. Laid out on the grid's own columns, on
 * the surface tone with a stronger top rule, a member count and how many still wait, so it reads
 * as a group and not as one more row; its members are indented under it when it is open.
 */
export function GroupRowView({ rows, ariaIndex, domId, active, expanded, compact, layout, onSelect, onToggle, onAccept, onReject, readOnly }: Props) {
  const { t, ta, locale } = useI18n();
  const g = ta.wsX.group;
  const u = ta.wsUi.group;
  const first = rows[0];
  const pending = rows.filter((r) => r.decision === 'pending').length;
  const progress = pending > 0 ? u.pending(fmtNumber(locale, pending), fmtNumber(locale, rows.length)) : g.done;
  const sameCurrent = first && rows.every((r) => r.currentMxik === first.currentMxik) ? first : null;
  const done = rows.length - pending;

  const cell = (key: ColumnKey): ReactNode => {
    switch (key) {
      case 'select':
        return <span role="gridcell" key={key} />;
      case 'no':
        return (
          <span role="gridcell" key={key} className="flex justify-end px-2">
            <button
              type="button" aria-expanded={expanded} aria-label={expanded ? g.collapse : g.expand}
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              className={cx('grid size-7 place-items-center rounded-sm text-muted transition-transform duration-(--duration-fast) hover:bg-sunken hover:text-fg', expanded && 'rotate-90')}
            >
              <IconChevron size={16} />
            </button>
          </span>
        );
      case 'product':
        return (
          <span role="gridcell" key={key} className="flex min-w-0 items-center gap-2 overflow-hidden px-3">
            <span className="min-w-0 truncate font-semibold text-fg" title={first?.productName}>{first?.productName}</span>
            <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-sunken px-2 text-micro font-medium tabular-nums text-fg">
              {count(locale, u.members, rows.length)}<span className="sr-only">, {count(locale, g.rows, rows.length)}</span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-micro text-muted" title={progress}>
              <span aria-hidden className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-sunken">
                <span className="block h-full rounded-full bg-good" style={{ width: `${Math.round((done / Math.max(1, rows.length)) * 100)}%` }} />
              </span>
              <span className={cx('min-w-0 truncate', compact && 'sr-only')}>{progress}</span>
            </span>
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
            {sameCurrent ? <CodeCell code={sameCurrent.currentMxik} name={sameCurrent.currentName} state={sameCurrent.currentState} empty={ta.wsX.noCode} compact /> : null}
          </span>
        );
      case 'suggested':
        return (
          <span role="gridcell" key={key} className="min-w-0 overflow-hidden px-3">
            {first?.suggestedMxik ? <CodeCell code={first.suggestedMxik} name={first.suggestedName} empty="—" compact /> : null}
          </span>
        );
      case 'match':
        return <span role="gridcell" key={key} />;
      case 'decision':
        return (
          <span role="gridcell" key={key} className={cx('sticky right-0 flex h-full items-center gap-1.5 border-l border-line px-3', rowSurface(active, true))} onClick={(e) => e.stopPropagation()}>
            {readOnly ? null : (
              <>
                <Button size="compact" variant="secondary" className="w-[6.75rem]" disabled={pending === 0} onClick={onAccept} aria-label={g.accept} title={g.accept}>{ta.wsX.act.accept}</Button>
                <Button size="compact" variant="ghost" className="w-[5.75rem]" disabled={pending === 0} onClick={onReject} aria-label={g.reject} title={g.reject}>{ta.wsX.act.reject}</Button>
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
      className={cx(
        'dense group relative grid h-full cursor-pointer items-center border-b border-t border-b-line border-t-line-strong',
        active ? cx('bg-brand-tint', ACTIVE_EDGE) : 'bg-surface hover:bg-sunken',
      )}
    >
      {layout.keys.map(cell)}
    </div>
  );
}
