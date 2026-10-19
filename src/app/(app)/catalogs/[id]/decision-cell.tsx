'use client';

import { isAutomatic } from '@/lib/decision-source';
import { useI18n } from '@/lib/locale-client';
import type { GridRow } from '@/lib/workspace-rows';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { Button } from '@/ui/button';
import { decisionText } from './ws-text';

export type DecisionHandlers = {
  onAccept: () => void;
  onReject: () => void;
  onPick: () => void;
  onUndo: () => void;
};

type Props = DecisionHandlers & { row: GridRow; readOnly: boolean; size?: 'compact' | 'sm' };

/** The row's decision controls: what accepting means depends on the check (take the suggestion, confirm the code, or pick one). */
export function DecisionCell({ row, readOnly, size = 'compact', onAccept, onReject, onPick, onUndo }: Props) {
  const { ta } = useI18n();
  const a = ta.wsX.act;
  const stop = (e: React.MouseEvent): void => e.stopPropagation();

  if (row.decision === 'pending') {
    if (readOnly) return <span className="text-small text-muted" title={a.readOnly}>{a.pending}</span>;
    const primary = row.mode === 'suggest'
      ? <Button size={size} variant="secondary" onClick={onAccept} title={a.acceptHint}>{a.accept}</Button>
      : row.mode === 'confirm'
        ? <Button size={size} variant="secondary" onClick={onAccept} title={a.confirmHint}>{a.confirm}</Button>
        : <Button size={size} variant="secondary" onClick={onPick}>{a.pick}</Button>;
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
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5" onClick={stop}>
      <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{decisionText(row, ta)}</StatusChip>
      {auto && row.decisionSource ? <span className="text-micro text-muted">{ta.matchX.decisionSource[row.decisionSource]}</span> : null}
      {readOnly || !row.decisionEventId ? null : (
        <Button size={size} variant="ghost" onClick={onUndo}>{a.undo}</Button>
      )}
    </span>
  );
}
