// "Nega bu kod?": the facts behind a suggestion, in plain words. Only what was
// measured is said; nothing is inferred beyond the stored evidence.
import type { MatchEvidence } from '@/core/match/evidence';
import { t } from '@/lib/i18n';

export function BarcodeBadge() {
  return (
    <span className="inline-block whitespace-nowrap border border-ok/30 bg-ok-tint px-1.5 py-0.5 text-xs text-ok">
      {t.badgeBarcode}
    </span>
  );
}

type Props = {
  evidence: MatchEvidence | null;
  confidence: number | null;
  rowUnit: string | null;
  codeUnit: string | null;
};

export function evidenceLines({ evidence, confidence, rowUnit, codeUnit }: Props): string[] {
  if (!evidence) return confidence === null ? [] : [t.whyScore(Math.round(confidence * 100))];
  const lines: string[] = [];
  if (evidence.barcode) lines.push(t.whyBarcode);
  if (evidence.exactName) lines.push(t.whyExact);
  if (!evidence.barcode && !evidence.exactName) {
    lines.push(evidence.matchedWords.length > 0 ? t.whyWords(evidence.matchedWords) : t.whyNoWords);
  }
  if (evidence.unit === 'match') lines.push(t.whyUnitMatch(rowUnit ?? codeUnit ?? ''));
  if (evidence.unit === 'conflict') lines.push(t.whyUnitConflict(rowUnit ?? '', codeUnit ?? ''));
  if (evidence.unit === 'unknown') lines.push(t.whyUnitUnknown);
  if (evidence.unit === 'none') lines.push(t.whyUnitNone);
  if (evidence.rerankNone) lines.push(t.whyRerankNone);
  else if (evidence.rerankReason) lines.push(t.whyRerank(evidence.rerankReason));
  if (confidence !== null) lines.push(t.whyScore(Math.round(confidence * 100)));
  return lines;
}

export function WhyThisCode(props: Props) {
  const lines = evidenceLines(props);
  if (lines.length === 0) return null;
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-ink-soft">{t.whyTitle}</summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-faint">
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </details>
  );
}
