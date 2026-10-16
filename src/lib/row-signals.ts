// "Nega bu kod?": stored match evidence as a short list of signals. Pure.
import type { MatchEvidence } from '../core/match/evidence.js';
import type { AppDict } from './i18n-app.js';

export type SignalTone = 'good' | 'warn' | 'bad' | 'neutral';
export type Signal = { label: string; text: string; tone: SignalTone };

type Input = { evidence: MatchEvidence | null; confidence: number | null; rowUnit: string | null; codeUnit: string | null };

export function rowSignals({ evidence, confidence, rowUnit, codeUnit }: Input, ta: AppDict): Signal[] {
  const m = ta.msg.signals;
  if (!evidence) {
    return confidence === null ? [] : [{ label: m.scoreLabel, text: m.score(Math.round(confidence * 100)), tone: 'neutral' }];
  }
  const out: Signal[] = [];
  if (evidence.stage === 'dictionary') out.push({ label: m.dictionaryLabel, text: m.dictionary(evidence.dictionaryUses ?? 1), tone: 'good' });
  if (evidence.barcode) out.push({ label: m.barcodeLabel, text: m.barcode, tone: 'good' });
  if (evidence.exactName) out.push({ label: m.nameLabel, text: m.exact, tone: 'good' });
  if (!evidence.barcode && !evidence.exactName && evidence.stage !== 'dictionary') {
    out.push(evidence.matchedWords.length > 0
      ? { label: m.nameLabel, text: m.words(evidence.matchedWords.join(', ')), tone: 'good' }
      : { label: m.nameLabel, text: m.noWords, tone: 'bad' });
  }
  if (evidence.unit === 'match') out.push({ label: m.unitLabel, text: m.unitMatch(rowUnit ?? codeUnit ?? ''), tone: 'good' });
  if (evidence.unit === 'conflict') out.push({ label: m.unitLabel, text: m.unitConflict(rowUnit ?? '', codeUnit ?? ''), tone: 'bad' });
  if (evidence.unit === 'unknown') out.push({ label: m.unitLabel, text: m.unitUnknown, tone: 'warn' });
  if (evidence.unit === 'none') out.push({ label: m.unitLabel, text: m.unitNone, tone: 'neutral' });
  if (evidence.rerankNone) out.push({ label: m.analysisLabel, text: m.rerankNone, tone: 'bad' });
  else if (evidence.rerankReason) out.push({ label: m.analysisLabel, text: evidence.rerankReason, tone: 'neutral' });
  return out;
}
