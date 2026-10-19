// Why a code was suggested, as facts a reviewer can check. Pure: computed in
// the pipeline, stored on the finding, and re-derivable from stored rows for
// catalogues audited before evidence existed.
import { matchKeyOf, tokenize } from '../normalize/index.js';
import { resolveUnit } from '../normalize/units.js';
import { RULE_KEYS, type RuleKey } from './rules.js';
import type { MatchStage } from './types.js';

export type UnitEvidence = 'match' | 'conflict' | 'unknown' | 'none';

export type MatchEvidence = {
  stage: MatchStage;
  /** The row's barcode maps to this code in the classifier. */
  barcode: boolean;
  /** The folded product name equals this code's folded name. */
  exactName: boolean;
  /** Row words also found in the code's name, folded to Latin. */
  matchedWords: string[];
  /** Row unit against the code's strictly bound unit; `none` = nothing bound. */
  unit: UnitEvidence;
  /** One Uzbek sentence from the reranker, when it scored this code. */
  rerankReason: string | null;
  /** The reranker judged that no candidate fits this row. */
  rerankNone: boolean;
  /** Legacy: how often the dictionary entry was learned, bulk accepts included. Not shown as confirmations. */
  dictionaryUses?: number;
  /** Individual or group decisions behind the dictionary entry; 0 = learned from bulk accepts only. */
  dictionaryConfirmations?: number;
  /** The firm dictionary maps this product's name to this other code; the barcode identity was kept. */
  dictionaryConflict?: string;
  /** Rule adjustments applied to this code (rules.ts keys). */
  rules?: RuleKey[];
};

export type EvidenceCandidate = {
  nameUz: string;
  nameRu: string;
  unitBinding: 'strict' | 'recommended' | 'none';
  unitCanonical: readonly string[];
};

/** Strict unit check that, unlike unitsCompatible, says when it cannot tell. */
export function unitEvidence(rowUnit: string | null, candidate: EvidenceCandidate): UnitEvidence {
  if (candidate.unitBinding !== 'strict' || candidate.unitCanonical.length === 0) return 'none';
  const row = resolveUnit(rowUnit);
  if (!row) return 'unknown';
  const bound = candidate.unitCanonical.map(resolveUnit).filter((u) => u !== null);
  if (bound.length === 0) return 'unknown';
  return bound.some((u) => u.id === row.id) ? 'match' : 'conflict';
}

/** Distinct row words (two letters or more, not bare numbers) present in the code's names. */
export function matchedWords(productName: string, candidate: EvidenceCandidate): string[] {
  const codeWords = new Set([
    ...tokenize(matchKeyOf(candidate.nameUz)),
    ...tokenize(matchKeyOf(candidate.nameRu)),
  ]);
  const seen = new Set<string>();
  for (const word of tokenize(matchKeyOf(productName))) {
    if (word.length < 2 || /^\d+$/.test(word) || seen.has(word)) continue;
    if (codeWords.has(word)) seen.add(word);
  }
  return [...seen].slice(0, 8);
}

export type EvidenceInput = {
  stage: MatchStage;
  productName: string;
  rowUnit: string | null;
  candidate: EvidenceCandidate;
  rerankReason?: string | null;
  rerankNone?: boolean;
  rules?: readonly RuleKey[];
};

export function evidenceFor(input: EvidenceInput): MatchEvidence {
  return {
    stage: input.stage,
    barcode: input.stage === 'barcode',
    exactName: input.stage === 'exact',
    matchedWords: matchedWords(input.productName, input.candidate),
    unit: unitEvidence(input.rowUnit, input.candidate),
    rerankReason: input.rerankReason ?? null,
    rerankNone: input.rerankNone ?? false,
    ...(input.rules && input.rules.length > 0 ? { rules: [...input.rules] } : {}),
  };
}

/** Evidence for a row the reranker vetoed: no code is suggested, and the veto itself is the fact. */
export function vetoEvidence(): MatchEvidence {
  return {
    stage: 'rerank', barcode: false, exactName: false, matchedWords: [], unit: 'none',
    rerankReason: null, rerankNone: true,
  };
}

const STAGES = new Set<MatchStage>(['barcode', 'exact', 'lexical', 'vector', 'fusion', 'rerank', 'dictionary', 'none']);
const UNITS = new Set<UnitEvidence>(['match', 'conflict', 'unknown', 'none']);
const RULES = new Set<string>(RULE_KEYS);

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Reads stored evidence back; anything malformed is treated as absent. */
export function readEvidence(value: unknown): MatchEvidence | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!STAGES.has(v['stage'] as MatchStage) || !UNITS.has(v['unit'] as UnitEvidence)) return null;
  const rules = Array.isArray(v['rules']) ? v['rules'].filter((r): r is RuleKey => typeof r === 'string' && RULES.has(r)) : [];
  return {
    stage: v['stage'] as MatchStage,
    barcode: v['barcode'] === true,
    exactName: v['exactName'] === true,
    matchedWords: Array.isArray(v['matchedWords']) ? v['matchedWords'].filter((w): w is string => typeof w === 'string') : [],
    unit: v['unit'] as UnitEvidence,
    rerankReason: typeof v['rerankReason'] === 'string' ? v['rerankReason'] : null,
    rerankNone: v['rerankNone'] === true,
    ...(isCount(v['dictionaryUses']) ? { dictionaryUses: v['dictionaryUses'] } : {}),
    ...(isCount(v['dictionaryConfirmations']) ? { dictionaryConfirmations: v['dictionaryConfirmations'] } : {}),
    ...(typeof v['dictionaryConflict'] === 'string' && /^\d{17}$/.test(v['dictionaryConflict']) ? { dictionaryConflict: v['dictionaryConflict'] } : {}),
    ...(rules.length > 0 ? { rules } : {}),
  };
}
