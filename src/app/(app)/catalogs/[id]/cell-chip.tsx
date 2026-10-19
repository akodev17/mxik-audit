import { StatusChip, StatusIcon, type Tone } from '@/ui/badge';

/**
 * A status chip that fits a narrow grid cell: the icon keeps its size and
 * only the label shortens, with an ellipsis and the full text as a title.
 */
export function CellChip({ tone, label, title }: { tone: Tone; label: string; title?: string }) {
  return (
    <StatusChip tone={tone} title={title ?? label} icon={<span className="inline-flex shrink-0"><StatusIcon tone={tone} size={12} /></span>} className="max-w-full">
      <span className="min-w-0 truncate">{label}</span>
    </StatusChip>
  );
}
