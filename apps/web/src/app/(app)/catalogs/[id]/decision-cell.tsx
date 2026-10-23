'use client';

import { isAutomatic } from '@/lib/workspace-url';
import { useI18n } from '@/lib/locale-client';
import type { GridRow } from './ws-types';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconCheck, IconX } from '@/ui/icons';
import { decisionText } from './ws-text';

export type DecisionHandlers = {
  onAccept: () => void;
  onReject: () => void;
  onPick: () => void;
  /** Takes the decision back: the row is pending again. */
  onUndo: () => void;
};

type Props = DecisionHandlers & {
  row: GridRow;
  readOnly: boolean;
  size?: 'compact' | 'sm';
  /** The drawer footer: the decision is the panel's one primary action, and a decided row offers "change decision". */
  prominent?: boolean;
};

// Grid rows: two slots of fixed width, so every row's buttons line up and nothing moves when a
// row is hovered, becomes active or is decided (the state takes the first slot, undo the second).
const SLOT_MAIN = 'w-[6.75rem]';
const SLOT_SIDE = 'w-[5.75rem]';

/** The row's decision controls: what accepting means depends on the check (take the suggestion, confirm the code, or pick one). */
export function DecisionCell({ row, readOnly, size = 'compact', prominent = false, onAccept, onReject, onPick, onUndo }: Props) {
  const { ta } = useI18n();
  const a = ta.wsX.act;
  const stop = (e: React.MouseEvent): void => e.stopPropagation();
  const grid = !prominent && size === 'compact';

  if (row.decision === 'pending') {
    if (readOnly) {
      return (
        <span className="flex min-w-0 flex-col">
          <span className="text-small text-muted">{a.pending}</span>
          {prominent ? <span className="text-micro text-muted">{a.readOnly}</span> : <span className="sr-only">{a.readOnly}</span>}
        </span>
      );
    }
    const variant = prominent ? 'primary' : 'secondary';
    const main = cx(grid && SLOT_MAIN, prominent && 'min-w-32');
    const primary = row.mode === 'suggest'
      ? <Button size={size} variant={variant} className={main} onClick={onAccept} title={a.acceptHint}>{a.accept}</Button>
      : row.mode === 'confirm'
        ? <Button size={size} variant={variant} className={main} onClick={onAccept} title={a.confirmHint}>{a.confirm}</Button>
        : <Button size={size} variant={variant} className={main} onClick={onPick}>{a.pick}</Button>;
    return (
      <span className="flex items-center gap-1.5" onClick={stop}>
        {primary}
        <Button size={size} variant={prominent ? 'secondary' : 'ghost'} className={cx(grid && SLOT_SIDE)} onClick={onReject} title={a.rejectHint}>{a.reject}</Button>
      </span>
    );
  }

  const accepted = row.decision === 'accepted';
  const auto = isAutomatic(row.decisionSource);
  const text = decisionText(row, ta);
  if (grid) {
    // One line that never wraps: the state shortens with an ellipsis (full text in its title).
    return (
      <span className="flex min-w-0 flex-nowrap items-center gap-1.5" onClick={stop}>
        <span className={cx('flex min-w-0 items-center gap-1.5 text-small font-medium', SLOT_MAIN, accepted ? 'text-good-ink' : 'text-muted')} title={text}>
          {accepted ? <IconCheck size={14} className="shrink-0" /> : <IconX size={14} className="shrink-0" />}
          <span className="min-w-0 truncate">{text}</span>
        </span>
        {auto && row.decisionSource ? <span className="sr-only">{ta.matchX.decisionSource[row.decisionSource]}</span> : null}
        {readOnly ? null : <Button size={size} variant="ghost" onClick={onUndo} title={a.changeHint} className={SLOT_SIDE}>{a.undo}</Button>}
      </span>
    );
  }

  const tone = accepted ? 'good' : 'neutral';
  return (
    // The drawer (prominent) and the phone cards have room for the wrapping layout and the source note.
    <span className={prominent ? 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5' : 'flex min-w-0 flex-nowrap items-center gap-1.5'} onClick={stop}>
      <span className="min-w-0">
        <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />} title={text}>{text}</StatusChip>
      </span>
      {auto && row.decisionSource
        ? <span className={prominent ? 'text-micro text-muted' : 'sr-only'}>{ta.matchX.decisionSource[row.decisionSource]}</span>
        : null}
      {readOnly ? null : prominent
        ? <Button size={size} variant="secondary" onClick={onUndo} title={a.changeHint}>{a.change}</Button>
        : <Button size={size} variant="ghost" onClick={onUndo} title={a.changeHint} className="shrink-0">{a.undo}</Button>}
    </span>
  );
}
