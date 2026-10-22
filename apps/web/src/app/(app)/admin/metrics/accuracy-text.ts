// How the accuracy page words the API's stable keys, in the viewer's language. The same choices as
// keyText/reasonText in packages/domain/src/accuracy.ts, which also reads the database and so cannot
// be imported here; keep the two in step.
import type { LabelKey } from '@tasnivo/core/match/confidence-labels';
import { dict, type Locale } from '@tasnivo/i18n/i18n';
import { appDict } from '@tasnivo/i18n/i18n-app';

export type Dimension = 'stage' | 'label' | 'org' | 'week';
export const DIMENSIONS: readonly Dimension[] = ['stage', 'label', 'org', 'week'];

/** Key of rows with no stage, or no score to band (accuracy.ts UNKNOWN_KEY). */
const UNKNOWN_KEY = 'unknown';
const UNKNOWN_WORD: Record<Locale, string> = { uz: 'Nomaʼlum', ru: 'Неизвестно' };

/** Label keys in reading order: score bands from best, then the identity sources. */
const LABEL_ORDER: readonly string[] = ['sure', 'likely', 'check', 'barcode', 'dictionary', UNKNOWN_KEY] satisfies readonly (LabelKey | typeof UNKNOWN_KEY)[];

function labelWords(locale: Locale): Record<LabelKey, string> {
  const t = dict(locale);
  const ta = appDict(locale);
  return {
    barcode: ta.matchX.label.barcode,
    dictionary: ta.matchX.label.dictionary,
    sure: t.confidenceSure,
    likely: t.confidenceLikely,
    check: t.confidenceCheck,
  };
}

/** How a row key reads: label keys and "unknown" in the viewer's language; stages, orgs and weeks as stored. */
export function keyText(dim: Dimension, key: string, locale: Locale): string {
  if (dim !== 'stage' && dim !== 'label') return key;
  if (key === UNKNOWN_KEY) return UNKNOWN_WORD[locale];
  if (dim === 'stage' || !LABEL_ORDER.includes(key)) return key;
  return labelWords(locale)[key as LabelKey];
}

/** A "wrong suggestion" reason key in the viewer's language; an unknown key as stored. */
export function reasonText(reason: string, locale: Locale): string {
  const words: Record<string, string> = appDict(locale).wrong.reasons;
  return Object.prototype.hasOwnProperty.call(words, reason) ? words[reason] ?? reason : reason;
}
