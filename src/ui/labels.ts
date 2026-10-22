// Display labels and tones for finding types and confidence, shared by every screen.
import { confidenceLabel, labelKey, type ConfidenceLabel, type LabelKey } from '@/core/match/confidence-labels';
import type { MatchStage } from '@/core/match/types';
import type { Dict } from '@/lib/i18n';
import type { AppDict } from '@/lib/i18n-app';
import type { Tone } from './badge';

/** Finding type names in the dictionary's language. */
export function typeLabels(t: Dict): Record<string, string> {
  return {
    MISSING: t.typeMissing,
    NOT_FOUND: t.typeNotFound,
    MISMATCH: t.typeMismatch,
    UNIT_CONFLICT: t.typeUnitConflict,
    NOT_PURCHASED: t.typeNotPurchased,
    PRIVILEGE_CODE: t.typePrivilegeCode,
    PRIVILEGE_OPPORTUNITY: t.typePrivilegeOpportunity,
    RESTRICTED: t.typeRestricted,
    OTHER: t.typeOther,
  };
}

/** Red for a wrong or absent code, amber for a doubtful one, grey for information. */
export function typeTone(type: string, severity: string): Tone {
  if (severity === 'info') return 'neutral';
  return type === 'MISSING' || type === 'NOT_FOUND' || (type === 'RESTRICTED' && severity === 'high') ? 'danger' : 'warn';
}

// A low band is less certainty, not an error: neutral, never the danger tone of problem types.
const TONE: Record<LabelKey, Tone> = { barcode: 'good', dictionary: 'good', sure: 'good', likely: 'warn', check: 'neutral' };

function bandText(t: Dict, key: ConfidenceLabel): string {
  const text: Record<ConfidenceLabel, string> = { sure: t.confidenceSure, likely: t.confidenceLikely, check: t.confidenceCheck };
  return text[key];
}

/**
 * The score band in words: Yuqori / Oʻrtacha / Past moslik. `percent` is the raw match
 * score for detail views; show it as a score, never as a probability.
 * Prefer suggestionLabel, which also names barcode and dictionary sources.
 */
export function confidenceView(t: Dict, confidence: number | null, barcode: boolean): { label: string; tone: Tone; percent: number } | null {
  if (confidence === null) return null;
  const key = confidenceLabel(confidence, { barcode });
  return { label: bandText(t, key), tone: TONE[key], percent: Math.round(confidence * 100) };
}

export type SuggestionLabel = { key: LabelKey; label: string; tone: Tone; percent: number | null };

/**
 * The label a suggestion carries: "Shtrix-kod boʻyicha" or "Firma lugʻatidan"
 * when the code came from an identity, otherwise the score band. Decided by
 * labelKey() in core/match/confidence-labels, like every other surface.
 */
export function suggestionLabel(t: Dict, ta: AppDict, input: { confidence: number | null; stage?: MatchStage | null }): SuggestionLabel | null {
  const key = labelKey(input.confidence, input.stage);
  if (!key) return null;
  const label = key === 'barcode' ? ta.matchX.label.barcode : key === 'dictionary' ? ta.matchX.label.dictionary : bandText(t, key);
  return { key, label, tone: TONE[key], percent: input.confidence === null ? null : Math.round(input.confidence * 100) };
}
