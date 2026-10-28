// Why a code was suggested, as facts a reviewer can check. Pure: computed in
// the pipeline, stored on the finding, and re-derivable from stored rows for
// catalogues audited before evidence existed.
import { matchKeyOf, normalizeName, tokenize } from '../normalize/index.js';
import { resolveUnit } from '../normalize/units.js';
import { MIN_QUERY_WORD } from './query.js';
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
  /** Seller words searched as the classifier's term ("арматура → прокат арматурный"), normalize/synonyms.ts. */
  synonymApplied?: string[];
  /** Query words found in the code's position, class or group names but not its own name, folded to Latin. */
  matchedHierarchyWords?: string[];
  /** Brand, size, dosage, volume, pack or model in the row that this identifying code repeats (rules.ts identifyingPreferred). */
  identifyingMatchedTokens?: string[];
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

/**
 * Distinct row words (three letters or more, not bare numbers) present in the
 * code's names. A fragment like "sh" from "б/ш" is no justification on its own;
 * the expansion it stands for ("besshovniye") is, so expanded words count too,
 * and so do the classifier terms a synonym searched for (`extra`), which the
 * evidence names separately.
 */
export function matchedWords(productName: string, candidate: EvidenceCandidate, extra: readonly string[] = []): string[] {
  const codeWords = new Set([
    ...tokenize(matchKeyOf(candidate.nameUz)),
    ...tokenize(matchKeyOf(candidate.nameRu)),
  ]);
  const seen = new Set<string>();
  for (const word of [...tokenize(matchKeyOf(productName)), ...normalizeName(productName).tokens, ...extra]) {
    if (word.length < MIN_QUERY_WORD || /^\d+$/.test(word) || seen.has(word)) continue;
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
  /** Synonym entries that fired for the row, and the classifier words they added to the query. */
  synonyms?: { applied: readonly string[]; added: readonly string[] };
  /** Query words the weighted full-text found only in this code's hierarchy (store.ts). */
  hierarchyWords?: readonly string[];
  /** Row tokens that earned the identifying preference (RuleOutcome.identifyingTokens). */
  identifyingTokens?: readonly string[];
};

export function evidenceFor(input: EvidenceInput): MatchEvidence {
  const synonymApplied = input.synonyms?.applied ?? [];
  // Fragments never count as evidence, here as in matchedWords.
  const hierarchy = [...new Set(input.hierarchyWords ?? [])]
    .filter((w) => w.length >= MIN_QUERY_WORD && !/^\d+$/.test(w)).slice(0, 8);
  const identifying = identifyingMatchedTokens(input.identifyingTokens);
  return {
    stage: input.stage,
    barcode: input.stage === 'barcode',
    exactName: input.stage === 'exact',
    matchedWords: matchedWords(input.productName, input.candidate, input.synonyms?.added),
    unit: unitEvidence(input.rowUnit, input.candidate),
    rerankReason: input.rerankReason ?? null,
    rerankNone: input.rerankNone ?? false,
    ...(input.rules && input.rules.length > 0 ? { rules: [...input.rules] } : {}),
    ...(synonymApplied.length > 0 ? { synonymApplied: [...synonymApplied] } : {}),
    ...(hierarchy.length > 0 ? { matchedHierarchyWords: hierarchy } : {}),
    ...(identifying.length > 0 ? { identifyingMatchedTokens: identifying } : {}),
  };
}

/** The tokens that justified preferring an identifying code, as written in the row, each once. */
export function identifyingMatchedTokens(tokens: readonly string[] | undefined): string[] {
  return [...new Set((tokens ?? []).map((t) => t.trim()).filter(Boolean))].slice(0, 8);
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
  const synonymApplied = Array.isArray(v['synonymApplied']) ? v['synonymApplied'].filter((s): s is string => typeof s === 'string') : [];
  const hierarchy = Array.isArray(v['matchedHierarchyWords']) ? v['matchedHierarchyWords'].filter((s): s is string => typeof s === 'string') : [];
  const identifying = Array.isArray(v['identifyingMatchedTokens']) ? v['identifyingMatchedTokens'].filter((s): s is string => typeof s === 'string') : [];
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
    ...(synonymApplied.length > 0 ? { synonymApplied } : {}),
    ...(hierarchy.length > 0 ? { matchedHierarchyWords: hierarchy } : {}),
    ...(identifying.length > 0 ? { identifyingMatchedTokens: identifyingMatchedTokens(identifying) } : {}),
  };
}
