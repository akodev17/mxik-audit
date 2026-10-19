import type { AttentionReason } from '@/lib/client-attention';
import { fmtNumber } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import type { AppDict } from '@/lib/i18n-app';
import { StatusChip, StatusIcon, type Tone } from '@/ui/badge';

export function reasonText(r: AttentionReason, ta: AppDict, locale: Locale): string {
  const words = ta.firmX.home.reasons;
  const n = fmtNumber(locale, r.count);
  if (r.kind === 'update') return words.update(n, r.count);
  if (r.kind === 'open') return words.open(n, r.count);
  if (r.kind === 'overdue') return words.overdue;
  if (r.kind === 'failed' || r.kind === 'analyzing' || r.kind === 'uploaded') return words[r.kind];
  return words.empty;
}

const TONE: Record<AttentionReason['kind'], Tone> = { update: 'danger', overdue: 'danger', failed: 'danger', open: 'warn', uploaded: 'warn', analyzing: 'info', empty: 'info' };

/** Why a client needs attention, each reason as colour, icon and words; "OK" when there is none. */
export function AttentionBadges({ reasons, ta, locale, okLabel }: { reasons: AttentionReason[]; ta: AppDict; locale: Locale; okLabel?: string }) {
  if (reasons.length === 0) {
    return okLabel ? <StatusChip tone="good" icon={<StatusIcon tone="good" size={12} />}>{okLabel}</StatusChip> : null;
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {reasons.map((r) => (
        <StatusChip key={r.kind} tone={TONE[r.kind]} icon={<StatusIcon tone={TONE[r.kind]} size={12} />}>{reasonText(r, ta, locale)}</StatusChip>
      ))}
    </span>
  );
}
