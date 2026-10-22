'use client';

import { isAutomatic } from '@tasnivo/domain/decision-source';
import { useI18n } from '@/lib/locale-client';
import type { GridRow } from '@tasnivo/domain/workspace-rows';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
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

/** The row's decision controls: what accepting means depends on the check (take the suggestion, confirm the code, or pick one). */
export function DecisionCell({ row, readOnly, size = 'compact', prominent = false, onAccept, onReject, onPick, onUndo }: Props) {
  const { ta } = useI18n();
  const a = ta.wsX.act;
  const stop = (e: React.MouseEvent): void => e.stopPropagation();
  const variant = prominent ? 'primary' : 'secondary';

  if (row.decision === 'pending') {
    if (readOnly) {
      return (
        <span className="flex min-w-0 flex-col">
          <span className="text-small text-muted">{a.pending}</span>
          {prominent ? <span className="text-micro text-muted">{a.readOnly}</span> : <span className="sr-only">{a.readOnly}</span>}
        </span>
      );
    }
    const primary = row.mode === 'suggest'
      ? <Button size={size} variant={variant} onClick={onAccept} title={a.acceptHint}>{a.accept}</Button>
      : row.mode === 'confirm'
        ? <Button size={size} variant={variant} onClick={onAccept} title={a.confirmHint}>{a.confirm}</Button>
        : <Button size={size} variant={variant} onClick={onPick}>{a.pick}</Button>;
    return (
      <span className="flex items-center gap-1.5" onClick={stop}>
        {primary}
        <Button size={size} variant="ghost" onClick={onReject} title={a.rejectHint}>{a.reject}</Button>
      </span>
    );
  }

  const tone = row.decision === 'accepted' ? 'good' : 'neutral';
  const auto = isAutomatic(row.decisionSource);
  return (
    // A grid row has a fixed height, so the compact form is one line that never wraps: the chip gives
    // way (its label ends in an ellipsis, the full text in its title) and the button keeps its size.
    // The drawer (prominent) has room for the wrapping layout and the source note.
    <span className={prominent ? 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5' : 'flex min-w-0 flex-nowrap items-center gap-1.5'} onClick={stop}>
      <span className="min-w-0">
        <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />} title={decisionText(row, ta)}>{decisionText(row, ta)}</StatusChip>
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
