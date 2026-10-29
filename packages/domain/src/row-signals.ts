// "Nega bu kod?": stored match evidence as a short list of signals. Pure.
import type { MatchEvidence } from '@tasnivo/core/match/evidence';
import type { RuleKey } from '@tasnivo/core/match/rules';
import type { AppDict } from '@tasnivo/i18n/i18n-app';

export type SignalTone = 'good' | 'warn' | 'bad' | 'neutral';
export type Signal = {
  label: string;
  text: string;
  tone: SignalTone;
  /** Shown under the text; set on machine-written signals ("check before accepting"). */
  note?: string;
  /** `ai` when the text was written by the model, so the UI can mark it. */
  source?: 'ai';
};

type Input = { evidence: MatchEvidence | null; confidence: number | null; rowUnit: string | null; codeUnit: string | null };

const RULE_TONE: Record<RuleKey, SignalTone> = {
  baseCodePreferred: 'good',
  identifyingMarked: 'good',
  identifyingUnmarked: 'warn',
  identifyingUnknownMarking: 'warn',
  identifyingPreferred: 'good',
  otherBrand: 'warn',
  cateringPreferred: 'good',
  cateringOutside: 'warn',
  strictUnitConflict: 'bad',
  recommendedUnitMatch: 'good',
  unitKindMismatch: 'warn',
  unrequestedMaterial: 'warn',
  headNounMismatch: 'warn',
};

function dictionarySignal(evidence: MatchEvidence, ta: AppDict): Signal {
  const m = ta.msg.signals;
  const x = ta.matchX.dictionary;
  const n = evidence.dictionaryConfirmations;
  // Confirmations count individual and group decisions only; bulk accepts are never shown as confirmations.
  if (n === undefined) return { label: m.dictionaryLabel, text: x.legacy, tone: 'neutral' };
  if (n === 0) return { label: m.dictionaryLabel, text: x.bulkOnly, tone: 'warn' };
  return { label: m.dictionaryLabel, text: m.dictionary(n), tone: 'good' };
}

function ruleSignals(evidence: MatchEvidence, ta: AppDict): Signal[] {
  const x = ta.matchX;
  // The unit line already reports a strict conflict.
  const keys = (evidence.rules ?? []).filter((k) => !(k === 'strictUnitConflict' && evidence.unit === 'conflict'));
  return keys.map((k) => ({ label: x.rulesLabel, text: x.rules[k], tone: RULE_TONE[k] }));
}

/** The row's TN VED heading: where the code came from, and whether the row's own code sits outside it. */
function tnvedSignals(evidence: MatchEvidence, heading: string, ta: AppDict): Signal[] {
  const x = ta.matchX;
  const out: Signal[] = [];
  if (evidence.tnvedFallback) out.push({ label: x.tnvedLabel, text: x.tnvedFallback(heading), tone: 'warn' });
  out.push(evidence.tnvedOutside
    ? { label: x.tnvedLabel, text: x.tnvedOutside(heading), tone: 'bad' }
    : { label: x.tnvedLabel, text: x.tnvedIn(heading), tone: 'good' });
  if (evidence.tnvedExistingOutside) out.push({ label: x.tnvedLabel, text: x.tnvedExistingOutside(heading), tone: 'warn' });
  return out;
}

export function rowSignals({ evidence, confidence, rowUnit, codeUnit }: Input, ta: AppDict): Signal[] {
  const m = ta.msg.signals;
  const ai = ta.matchX.ai;
  if (!evidence) {
    return confidence === null ? [] : [{ label: m.scoreLabel, text: m.score(Math.round(confidence * 100)), tone: 'neutral' }];
  }
  const out: Signal[] = [];
  if (evidence.stage === 'dictionary') out.push(dictionarySignal(evidence, ta));
  if (evidence.barcode) out.push({ label: m.barcodeLabel, text: m.barcode, tone: 'good' });
  if (evidence.dictionaryConflict) out.push({ label: m.dictionaryLabel, text: ta.matchX.dictionary.conflict(evidence.dictionaryConflict), tone: 'warn' });
  if (evidence.exactName) out.push({ label: m.nameLabel, text: m.exact, tone: 'good' });
  if (!evidence.barcode && !evidence.exactName && evidence.stage !== 'dictionary' && !evidence.rerankNone) {
    out.push(evidence.matchedWords.length > 0
      ? { label: m.nameLabel, text: m.words(evidence.matchedWords.join(', ')), tone: 'good' }
      : { label: m.nameLabel, text: m.noWords, tone: 'bad' });
  }
  if (evidence.matchedHierarchyWords && evidence.matchedHierarchyWords.length > 0) {
    out.push({ label: ta.matchX.hierarchyLabel, text: ta.matchX.hierarchy(evidence.matchedHierarchyWords.join(', ')), tone: 'good' });
  }
  if (evidence.tnvedHeading) out.push(...tnvedSignals(evidence, evidence.tnvedHeading, ta));
  if (evidence.identifyingMatchedTokens && evidence.identifyingMatchedTokens.length > 0) {
    out.push({ label: ta.matchX.identifyingLabel, text: ta.matchX.identifying(evidence.identifyingMatchedTokens.join(', ')), tone: 'good' });
  }
  if (evidence.synonymApplied && evidence.synonymApplied.length > 0) {
    out.push({ label: ta.matchX.synonymLabel, text: ta.matchX.synonym(evidence.synonymApplied.join('; ')), tone: 'neutral' });
  }
  if (evidence.unit === 'match') out.push({ label: m.unitLabel, text: m.unitMatch(rowUnit ?? codeUnit ?? ''), tone: 'good' });
  if (evidence.unit === 'conflict') out.push({ label: m.unitLabel, text: m.unitConflict(rowUnit ?? '', codeUnit ?? ''), tone: 'bad' });
  if (evidence.unit === 'unknown') out.push({ label: m.unitLabel, text: m.unitUnknown, tone: 'warn' });
  if (evidence.unit === 'none' && !evidence.rerankNone) out.push({ label: m.unitLabel, text: m.unitNone, tone: 'neutral' });
  out.push(...ruleSignals(evidence, ta));
  if (evidence.rerankNone) out.push({ label: ai.label, text: m.rerankNone, tone: 'bad', note: ai.note, source: 'ai' });
  else if (evidence.rerankReason) out.push({ label: ai.label, text: evidence.rerankReason, tone: 'neutral', note: ai.note, source: 'ai' });
  return out;
}
