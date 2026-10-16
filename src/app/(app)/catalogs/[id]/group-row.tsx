'use client';

import { useI18n } from '@/lib/locale-client';
import type { GridRow } from '@/lib/workspace-rows';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { IconChevron } from '@/ui/icons';
import { COLUMNS } from './columns';

type Props = {
  rows: GridRow[];
  active: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onAccept: () => void;
  onReject: () => void;
  readOnly: boolean;
};

/** Header of a group of similar rows: one decision covers every pending member. */
export function GroupRowView({ rows, active, expanded, onSelect, onToggle, onAccept, onReject, readOnly }: Props) {
  const { ta } = useI18n();
  const first = rows[0];
  const pending = rows.filter((r) => r.decision === 'pending').length;
  return (
    <div
      role="row"
      onClick={onSelect}
      style={{ gridTemplateColumns: COLUMNS }}
      className={`dense grid h-full cursor-pointer items-center border-b border-line ${active ? 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)]' : 'bg-surface hover:bg-[#ebf0f5]'}`}
    >
      <span />
      <span className="px-3">
        <button type="button" aria-expanded={expanded} onClick={(e) => { e.stopPropagation(); onToggle(); }} className={`grid size-6 place-items-center text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}>
          <IconChevron />
        </button>
      </span>
      <span className="col-span-2 flex min-w-0 items-center gap-2 px-3">
        <span className="truncate font-medium" title={first?.productName}>{first?.productName}</span>
        <Badge tone="brand">{ta.ws.groupRows(rows.length)}</Badge>
      </span>
      <span className="px-3 text-sm text-muted">{pending > 0 ? `${pending} ${ta.ws.pending.toLowerCase()}` : ta.ws.accepted}</span>
      <span className="min-w-0 px-3">{first?.suggestedMxik ? <CodeChip code={first.suggestedMxik} /> : null}</span>
      <span />
      <span className="flex items-center gap-1.5 px-3" onClick={(e) => e.stopPropagation()}>
        {readOnly ? null : (
          <>
            <Button size="sm" variant="secondary" disabled={pending === 0} onClick={onAccept}>{ta.ws.groupAccept}</Button>
            <Button size="sm" variant="ghost" disabled={pending === 0} onClick={onReject}>{ta.ws.groupReject}</Button>
          </>
        )}
      </span>
    </div>
  );
}
