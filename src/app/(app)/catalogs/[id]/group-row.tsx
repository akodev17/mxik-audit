'use client';

import { fmtNumber } from '@/lib/format';
import { useI18n } from '@/lib/locale-client';
import type { GridRow } from '@/lib/workspace-rows';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { cx } from '@/ui/cx';
import { IconChevron } from '@/ui/icons';
import type { Layout } from './columns';
import { rowSurface } from './grid-row';
import { count } from './ws-text';

type Props = {
  rows: GridRow[];
  ariaIndex: number;
  domId: string;
  active: boolean;
  expanded: boolean;
  layout: Layout;
  onSelect: () => void;
  onToggle: () => void;
  onAccept: () => void;
  onReject: () => void;
  readOnly: boolean;
};

/** Header of a group of similar loaded rows: one decision, one audit event and one undo for every pending member. */
export function GroupRowView({ rows, ariaIndex, domId, active, expanded, layout, onSelect, onToggle, onAccept, onReject, readOnly }: Props) {
  const { ta, locale } = useI18n();
  const g = ta.wsX.group;
  const first = rows[0];
  const pending = rows.filter((r) => r.decision === 'pending').length;
  // Everything between the toggle and the decision shares one wide cell.
  const middle = layout.keys.filter((k) => k !== 'select' && k !== 'no' && k !== 'decision').length;
  return (
    <div
      role="row" id={domId} aria-rowindex={ariaIndex} aria-selected={active} aria-expanded={expanded}
      onClick={onSelect}
      style={{ gridTemplateColumns: layout.template }}
      className={cx('dense group grid h-full cursor-pointer items-center border-b border-line', active ? 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)]' : 'bg-surface hover:bg-sunken')}
    >
      {layout.keys.includes('select') ? <span role="gridcell" /> : null}
      <span role="gridcell" className="px-2">
        <button
          type="button" aria-expanded={expanded} aria-label={expanded ? g.collapse : g.expand}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className={cx('grid size-7 place-items-center rounded-sm text-muted hover:bg-sunken hover:text-fg transition-transform duration-(--duration-fast)', expanded && 'rotate-90')}
        >
          <IconChevron size={16} />
        </button>
      </span>
      <span role="gridcell" style={{ gridColumn: `span ${middle}` }} className="flex min-w-0 items-center gap-2 px-3">
        <span className="truncate font-medium text-fg" title={first?.productName}>{first?.productName}</span>
        <Badge tone="brand">{count(locale, g.rows, rows.length)}</Badge>
        {first?.suggestedMxik ? <CodeChip code={first.suggestedMxik} className="hidden lg:inline-block" /> : null}
        <span className="ml-auto shrink-0 text-small text-muted">{pending > 0 ? g.pendingOf(fmtNumber(locale, pending), fmtNumber(locale, rows.length)) : g.done}</span>
      </span>
      <span role="gridcell" className={cx('sticky right-0 flex h-full items-center gap-1.5 border-l border-line px-3', active ? 'bg-brand-tint' : rowSurface(false, true))} onClick={(e) => e.stopPropagation()}>
        {readOnly ? null : (
          <>
            <Button size="compact" variant="secondary" disabled={pending === 0} onClick={onAccept} aria-label={g.accept} title={g.accept}>{ta.wsX.act.accept}</Button>
            <Button size="compact" variant="ghost" disabled={pending === 0} onClick={onReject} aria-label={g.reject} title={g.reject}>{ta.wsX.act.reject}</Button>
          </>
        )}
      </span>
    </div>
  );
}
