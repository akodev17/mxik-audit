// Display labels and tones for finding types and confidence, shared by every screen.
import { confidenceLabel, type ConfidenceLabel } from '@/core/match/confidence-labels';
import type { Dict } from '@/lib/i18n';
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
  };
}

/** Red for a wrong or absent code, amber for a doubtful one, grey for information. */
export function typeTone(type: string, severity: string): Tone {
  if (severity === 'info') return 'neutral';
  return type === 'MISSING' || type === 'NOT_FOUND' ? 'danger' : 'warn';
}

const CONFIDENCE_TONE: Record<ConfidenceLabel, Tone> = { sure: 'good', likely: 'warn', check: 'danger' };

export function confidenceView(t: Dict, confidence: number | null, barcode: boolean): { label: string; tone: Tone; percent: number } | null {
  if (confidence === null) return null;
  const key = confidenceLabel(confidence, { barcode });
  const text: Record<ConfidenceLabel, string> = { sure: t.confidenceSure, likely: t.confidenceLikely, check: t.confidenceCheck };
  return { label: text[key], tone: CONFIDENCE_TONE[key], percent: Math.round(confidence * 100) };
}
