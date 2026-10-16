// Small status badges. No server imports, so client components can use them.
import { confidenceLabel } from '@/core/match/confidence-labels';
import { t } from '@/lib/i18n';

const LABEL_STYLE = {
  sure: 'bg-ok-tint text-ok border-ok/30',
  likely: 'bg-[#fdf6e7] text-[#8a5a00] border-[#8a5a00]/25',
  check: 'bg-risk-tint text-risk border-risk/25',
} as const;

const LABEL_TEXT = {
  sure: t.confidenceSure,
  likely: t.confidenceLikely,
  check: t.confidenceCheck,
} as const;

/** A plain-language label; the raw number is detail, kept in the tooltip. */
export function ConfidenceBadge({ confidence, barcode }: { confidence: number | null; barcode?: boolean }) {
  if (confidence === null) return <span className="text-xs text-ink-faint">—</span>;
  const label = confidenceLabel(confidence, { barcode });
  return (
    <span
      title={t.confidenceDetail(Math.round(confidence * 100))}
      className={`inline-block whitespace-nowrap border px-1.5 py-0.5 text-xs ${LABEL_STYLE[label]}`}
    >
      {LABEL_TEXT[label]}
    </span>
  );
}

const TYPE_LABEL: Record<string, string> = {
  MISSING: t.typeMissing,
  NOT_FOUND: t.typeNotFound,
  MISMATCH: t.typeMismatch,
  UNIT_CONFLICT: t.typeUnitConflict,
};

export function TypeBadge({ type, severity }: { type: string; severity: string }) {
  const high = severity === 'high';
  return (
    <span
      className={`inline-block whitespace-nowrap border px-1.5 py-0.5 text-xs ${
        high ? 'border-risk/30 bg-risk-tint text-risk' : 'border-rule bg-paper-tint text-ink-soft'
      }`}
    >
      {TYPE_LABEL[type] ?? type}
    </span>
  );
}

export { TYPE_LABEL };
