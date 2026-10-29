// The ordered cascade. First strong hit wins, but the top five are always
// returned so the reviewer has alternatives.
//
//   1 barcode exact      confidence 1.00
//   2 folded name exact  confidence 0.95
//   3 lexical (trigram)  |
//   4 vector (pgvector)  |-> 5 reciprocal rank fusion -> 6 LLM rerank
import { barcodeIdentity, normalizeName, tokenize, type BarcodeIdentity } from '../normalize/index.js';
import { applySynonyms } from '../normalize/synonyms.js';
import { dictionaryKeys, type DictionaryEntry, type DictionaryLookup } from './dictionary.js';
import { ALIAS_SLOTS, type AliasHit, type AliasLookup } from './alias.js';
import { NoopRerankProvider } from './rerank.js';
import { diversify, groupFusion, positionPool, reciprocalRankFusion, type FusedItem } from './fusion.js';
import type { RerankGate } from './rerank-config.js';
import { rerankStep } from './rerank-step.js';
import { evidenceFor, withTnved } from './evidence.js';
import { headingPrefix, outsideHeading, readTnved } from './tnved.js';
import { lexicalQuery } from './query.js';
import { headStem, rowHead } from '../normalize/russian.js';
import { isUnrelated } from './relevance.js';
import { applyRules, hierarchyPath, type RuleOutcome } from './rules.js';
import { identifyingMatch, identifyingQuery, namesBrandOf, rowIdentity } from './identifying.js';
import { adjustedScore, bandOf, calibratePool, cosineToUnit, fullTextToUnit, vectorToUnit, type SignalWeights, type VectorCalibration } from './score.js';
import type { VectorColumn } from './vector-readiness.js';
import { embeddingText } from '../embed/text.js';
import type { ScriptKind } from '../normalize/index.js';
import type {
  CandidateStore, EmbeddingProvider, MatchInput, MatchResult, MxikCandidate,
  RerankProvider, ScoredCandidate, TnvedOutcome, VectorOutcome,
} from './types.js';

export type PipelineOptions = {
  store: CandidateStore;
  embedder: EmbeddingProvider;
  reranker: RerankProvider;
  /** What this org confirmed before; checked first and ranked above everything else. */
  dictionary?: DictionaryLookup | undefined;
  /** Approved global aliases (alias.ts): one more retrieval list, never an override of stages 0-2. */
  aliases?: AliasLookup | undefined;
  /** Only rows this gate calls uncertain go to the reranker. Absent = all fused rows. */
  rerankGate?: RerankGate | undefined;
  /** Stages to switch off: for ablation in the eval, and stage 4 when the stored vectors are unusable. */
  disabledStages?: ReadonlySet<DisableableStage> | undefined;
  /** Receives the time spent in each stage, for performance runs. */
  timer?: StageTimer | undefined;
  /** How many rows each retrieval stage pulls. */
  retrievalLimit?: number;
  /** How many fused candidates go to the reranker. */
  rerankLimit?: number;
  /**
   * Codes per subposition in the reranker pool (fusion.ts positionPool); 3 when
   * absent, null = the plain top `rerankLimit` of the fused list.
   */
  poolPerPosition?: number | null;
  /** Subpositions the pool is topped up to when the top of the fused list has fewer; 4 when absent. */
  poolMinPositions?: number;
  /** False switches off rules.ts identifyingPreferred, for ablation in the eval; on when absent. */
  identifyingRule?: boolean;
  /** False skips the identifying full-text query (identifying.ts identifyingQuery); on when absent. */
  identifyingRetrieval?: boolean;
  /** False switches off rules.ts headNounMismatch, for ablation in the eval; on when absent. */
  headNounRule?: boolean;
  /** How many results to return. */
  topK?: number;
  /**
   * Group key for position-level fusion (plan §3.2): the 11-digit
   * subposition, the 8-digit position, or 'off'. See fusion.ts groupFusion.
   */
  positionFusion?: PositionFusion;
  /** Codes per position counted in each list by position fusion; unlimited when absent. */
  positionFusionCap?: number;
  /**
   * RRF weight of the vector list when the embedder is not semantic (the
   * hashing stand-in), which then also gives no vector signal to the score
   * (plan §5). 0 skips the stage. Unset: the stand-in counts like a real model.
   */
  nonSemanticVectorWeight?: number;
  /** Signal weights for calibration; score.ts WEIGHTS when absent (a weight fit passes others). */
  weights?: SignalWeights;
  /** Vector columns holding the provider's vectors (embedding_state.columns); ['uz'] when absent. */
  vectorColumns?: readonly VectorColumn[];
  /**
   * Codes per subposition kept from the vector list before fusion (fusion.ts
   * diversify), so one position's many sizes cannot flood the fused pool.
   * Absent = no cap.
   */
  vectorPerPosition?: number;
  /** Cosine band of a semantic provider; score.ts SEMANTIC_COSINE when absent, null = the pre-2026-10-22 (1 + cos) / 2. */
  vectorCalibration?: VectorCalibration | null;
  /**
   * False leaves pool codes the vector stage did not return without a vector
   * signal, as before 2026-10-29 (for ablation in the eval); on when absent.
   */
  vectorFill?: boolean;
  /**
   * False keeps a subposition's base code out of the pool when only its
   * identifying codes were retrieved (basesForLeaves), as before 2026-10-29; on when absent.
   */
  baseForLeaves?: boolean;
};

/**
 * Which vector columns a row searches: the column of its own script when it is
 * filled (Cyrillic -> embeddingRu from nameRu, Latin -> embeddingUz from
 * nameUz), every filled column for mixed or script-less names.
 */
export function vectorColumnsFor(script: ScriptKind, available: readonly VectorColumn[]): VectorColumn[] {
  const own: VectorColumn | null = script === 'cyrillic' ? 'ru' : script === 'latin' ? 'uz' : null;
  if (own && available.includes(own)) return [own];
  return available.length > 0 ? [...available] : ['uz'];
}

/** Nearest codes over one or more columns, each code once at its best cosine. */
async function searchColumns(
  store: CandidateStore, vec: readonly number[], limit: number, columns: readonly VectorColumn[],
): Promise<{ candidate: MxikCandidate; score: number; cosine?: number }[]> {
  if (columns.length === 1) return store.byVector(vec, limit, columns[0]);
  const lists = await Promise.all(columns.map((c) => store.byVector(vec, limit, c)));
  const best = new Map<string, { candidate: MxikCandidate; score: number; cosine?: number }>();
  for (const hit of lists.flat()) {
    const seen = best.get(hit.candidate.code);
    if (!seen || hit.score > seen.score) best.set(hit.candidate.code, hit);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.candidate.code.localeCompare(b.candidate.code)).slice(0, limit);
}

export type PositionFusion = 'subposition' | 'position' | 'off';

const groupKey: Record<Exclude<PositionFusion, 'off'>, (c: MxikCandidate) => string> = {
  subposition: (c) => c.subPositionCode,
  position: (c) => c.code.slice(0, 8),
};

export type DisableableStage = 'barcode' | 'exact' | 'lexical' | 'vector';

export type StageTimer = { add(stage: string, ms: number): void };

/** Runs `fn`, reporting its duration to `timer` under `stage` when there is one. */
export async function timed<T>(timer: StageTimer | undefined, stage: string, fn: () => Promise<T>): Promise<T> {
  if (!timer) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    timer.add(stage, performance.now() - t0);
  }
}

type FusedCandidate = FusedItem<MxikCandidate>;

/** A base code is its subposition followed by six zeros (every live base code is). */
const BASE_SUFFIX = '000000';

/** Most codes the identifying full-text query adds to the reranker pool. */
const IDENTIFYING_SLOTS = 3;

const DEFAULTS = { retrievalLimit: 50, rerankLimit: 20, topK: 5, poolPerPosition: null, poolMinPositions: 4 } as const;

/**
 * The pool's composition for operators and the eval: "Rerank pool: 6 codes in 4
 * subpositions (07306001005 ×3, ...)", and what position diversity changed
 * against the plain top of the fused list.
 */
export function poolNote(pool: readonly MxikCandidate[], window: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const c of pool) counts.set(c.subPositionCode, (counts.get(c.subPositionCode) ?? 0) + 1);
  const parts = [...counts].map(([sub, n]) => (n > 1 ? `${sub} ×${n}` : sub));
  const inWindow = new Set(window);
  const added = pool.filter((c) => !inWindow.has(c.code)).length;
  const dropped = window.length - (pool.length - added);
  const change = dropped > 0 || added > 0 ? `; ${dropped} left out over the per-subposition cap, ${added} added from other subpositions` : '';
  return `Rerank pool: ${pool.length} codes in ${counts.size} subpositions (${parts.join(', ')})${change}.`;
}

/** Wraps a definite hit from stages 1-2, which bypass scoring. */
function certain(
  candidate: MxikCandidate,
  confidence: number,
  stage: 'barcode' | 'exact',
  reason: string,
  rowUnit: string | null,
  catering: boolean,
  productName: string,
): ScoredCandidate {
  const rules = applyRules({ candidate, rowUnit, catering });
  return {
    candidate,
    signals: {},
    ranks: {},
    // A barcode or exact-name identity is not a guess, so rule adjustments do
    // not lower it; they are still reported so a unit conflict stays visible.
    confidence,
    band: bandOf(confidence),
    reason,
    stage,
    adjustments: rules.notes,
    evidence: evidenceFor({ stage, productName, rowUnit, candidate, rules: rules.keys }),
  };
}

/** Why a row's barcode was not used as an identity, for the operator notes. */
function barcodeNote(raw: string, identity: BarcodeIdentity): string | null {
  if (identity.status === 'bad_length') return `Barcode "${raw}" is not a valid GTIN length; ignored.`;
  if (identity.status === 'bad_check_digit') return `Barcode "${raw}" fails the GTIN check digit; ignored.`;
  if (identity.status === 'restricted') return `Barcode "${raw}" is a restricted-circulation (in-store) number, not a product identity; matching by name.`;
  return null;
}

/** Confidence of a code the org itself confirmed: in the high band, never above a barcode identity. */
export const DICTIONARY_CONFIDENCE = 0.96;

function dictionaryCandidate(input: MatchInput, candidate: MxikCandidate, hit: DictionaryEntry): ScoredCandidate {
  return {
    candidate,
    signals: {},
    ranks: {},
    confidence: DICTIONARY_CONFIDENCE,
    band: bandOf(DICTIONARY_CONFIDENCE),
    reason: 'Firma lugʻatida bu mahsulot uchun shu kod saqlangan.',
    stage: 'dictionary',
    adjustments: [],
    evidence: {
      ...evidenceFor({ stage: 'dictionary', productName: input.rawName, rowUnit: input.unit ?? null, candidate }),
      dictionaryUses: hit.uses,
      dictionaryConfirmations: hit.confirmations ?? 0,
    },
  };
}

/**
 * Records the row's TN VED heading on every candidate's evidence: the heading,
 * whether this code or the row's own code lies outside it, and whether
 * retrieval had to fall back to the whole classifier.
 */
function stampTnved(result: MatchResult): MatchResult {
  const read = readTnved(result.input.tnved);
  if (read.status !== 'ok') return result;
  const heading = read.heading;
  const facts = {
    heading,
    existingOutside: outsideHeading((result.input.existingMxik ?? '').replace(/\D/g, ''), heading),
    fallback: result.tnved === 'fallback',
  };
  const outside = (code: string): boolean => outsideHeading(code, heading);
  return {
    ...result,
    candidates: result.candidates.map((c) => ({ ...c, evidence: withTnved(c.evidence, c.candidate.code, facts, outside) })),
  };
}

/** Stage 0: the firm dictionary, then the normal cascade for the alternatives. */
export async function matchProduct(input: MatchInput, opts: PipelineOptions): Promise<MatchResult> {
  return stampTnved(await matchWithDictionary(input, opts));
}

async function matchWithDictionary(input: MatchInput, opts: PipelineOptions): Promise<MatchResult> {
  const hit = opts.dictionary?.find(dictionaryKeys(input)) ?? null;
  const candidate = hit ? await opts.store.byCode(hit.code) : null;
  // A mapping whose code left the classifier is ignored, never shown.
  if (!hit || !candidate || !(await opts.store.liveCodes([hit.code])).has(hit.code)) return matchCore(input, opts);

  // The org already decided, so the cascade runs only for alternatives: no LLM call.
  const base = await matchCore(input, { ...opts, reranker: new NoopRerankProvider('dictionary') });
  const limit = opts.topK ?? DEFAULTS.topK;
  const top = dictionaryCandidate(input, candidate, hit);

  // A name-keyed entry never outranks the row's own barcode identity; the disagreement is shown, not resolved.
  const barcodeTop = base.decidedBy === 'barcode' ? base.candidates[0] : undefined;
  if (barcodeTop && hit.kind === 'name' && barcodeTop.candidate.code !== hit.code) {
    const flagged: ScoredCandidate = { ...barcodeTop, evidence: { ...barcodeTop.evidence, dictionaryConflict: hit.code } };
    return {
      ...base,
      rerank: 'not_needed',
      notes: [...base.notes, `Firm dictionary maps this name to ${hit.code}, but the barcode identifies ${barcodeTop.candidate.code}; barcode kept.`],
      candidates: [flagged, top].slice(0, limit),
    };
  }

  const rest = base.candidates.filter((c) => c.candidate.code !== hit.code);
  return { ...base, decidedBy: 'dictionary', rerank: 'not_needed', candidates: [top, ...rest].slice(0, limit) };
}

async function matchCore(input: MatchInput, opts: PipelineOptions): Promise<MatchResult> {
  const limits = { ...DEFAULTS, ...opts };
  const { store, embedder, reranker } = opts;
  const notes: string[] = [];
  const normalized = normalizeName(input.rawName);
  const rowUnit = input.unit ?? null;
  // Synonyms reach the lexical query only; the vector stage embeds the row as
  // written. The catering lexicon also says whether the row is a cafe's
  // (rules.ts cateringPreferred), which the short-circuit stages report too.
  const query = normalized.queryKey || normalized.matchKey || normalized.core;
  const synonyms = applySynonyms(query, { name: input.rawName, unit: rowUnit, existingMxik: input.existingMxik ?? null });
  const catering = synonyms.groups.includes('catering');
  const off = (stage: DisableableStage): boolean => opts.disabledStages?.has(stage) ?? false;

  // The row's TN VED heading limits stages 2-4 to its MXIK codes (tnved.ts);
  // the barcode stage stays global, since a barcode is an identity.
  const tnved = readTnved(input.tnved);
  const scoped = tnved.status === 'ok' && store.withinPrefix ? store.withinPrefix(headingPrefix(tnved.heading)) : null;
  const retrieval = scoped ?? store;
  const tnvedOutcome: TnvedOutcome = tnved.status === 'empty' ? 'none' : tnved.status === 'bad' ? 'invalid' : scoped ? 'restricted' : 'unscoped';
  if (tnved.status === 'bad') notes.push(`TN VED "${input.tnved ?? ''}" is not a 4-10 digit HS code; ignored.`);
  if (tnved.status === 'ok') {
    notes.push(scoped
      ? `Retrieval limited to TN VED heading ${tnved.heading} (MXIK codes ${headingPrefix(tnved.heading)}…).`
      : `TN VED heading ${tnved.heading} recorded; this store cannot limit retrieval to it.`);
  }
  const settled = { rerank: 'not_needed', vector: 'not_needed', veto: null, tnved: tnvedOutcome } as const;
  /** The heading left nothing: the same row over the whole classifier, saying so. */
  const unrestricted = async (why: string): Promise<MatchResult> => {
    const all = await matchCore({ ...input, tnved: null }, opts);
    const heading = tnved.status === 'ok' ? tnved.heading : '';
    return { ...all, input, tnved: 'fallback', notes: [`TN VED heading ${heading}: ${why}; searched the whole classifier.`, ...all.notes] };
  };

  if (catering) notes.push('Read as a food-service item (prepared dish, drink or service); the catering group 10202 is preferred.');
  if (!off('vector') && !embedder.semantic) notes.push(`Vector stage is using "${embedder.name}" — surface-form only, not semantic.`);
  if (!reranker.available) notes.push(`Reranker unavailable (${reranker.name}); confidence is capped.`);

  // ---------------------------------------------------------------- 1. barcode
  if (!off('barcode') && input.barcode) {
    const identity = barcodeIdentity(input.barcode);
    const barcode = identity.gtin;
    if (barcode) {
      const hits = await timed(opts.timer, 'barcode', () => store.byBarcode(barcode));
      if (hits.length === 1 && hits[0]) {
        return {
          input, normalized, decidedBy: 'barcode', notes, pool: [hits[0].code], ...settled,
          candidates: [certain(hits[0], 1, 'barcode', `Barcode ${barcode} matches this code exactly in the classifier.`, rowUnit, catering, input.rawName)],
        };
      }
      if (hits.length > 1) notes.push(`Barcode ${barcode} maps to ${hits.length} codes; falling through to name matching.`);
    }
    const note = barcodeNote(input.barcode, identity);
    if (note) notes.push(note);
  }

  // ---------------------------------------------------------- 2. folded exact
  if (normalized.matchKey && !off('exact')) {
    const keys = [normalized.matchKey, normalized.sortedKey, ...normalized.literalKeys];
    const exact = await timed(opts.timer, 'exact', () => retrieval.byMatchKey(keys));
    if (exact.length === 1 && exact[0]) {
      return {
        input, normalized, decidedBy: 'exact', notes, pool: [exact[0].code], ...settled,
        candidates: [certain(exact[0], 0.95, 'exact', 'Product name matches this classifier entry exactly after normalization.', rowUnit, catering, input.rawName)],
      };
    }
    if (exact.length > 1) notes.push(`${exact.length} codes share this normalized name; ranking them.`);
  }

  // -------------------------------------------------- 3+4. lexical and vector
  if (synonyms.applied.length > 0) notes.push(`Searched with the classifier's term: ${synonyms.applied.join('; ')}.`);
  const lexicalText = lexicalQuery(synonyms.text);
  // The vector stage must not be able to take down the audit: a provider outage
  // or an exhausted quota degrades retrieval to lexical rather than throwing.
  // A disabled stage computes no query embedding at all.
  type Hit = { candidate: MxikCandidate; score: number; cosine?: number; hierarchyWords?: string[] };
  // A non-semantic stand-in gives surface-form neighbours, not meaning: it may
  // enter fusion at a reduced weight but never scores a candidate (plan §5).
  const standIn = !embedder.semantic && opts.nonSemanticVectorWeight !== undefined;
  const vectorWeight = standIn ? opts.nonSemanticVectorWeight ?? 1 : 1;
  const skipVector = off('vector') || vectorWeight <= 0;
  if (standIn && !off('vector')) {
    notes.push(vectorWeight <= 0
      ? 'Non-semantic vector stage skipped: it is not used for fusion or scoring.'
      : `Non-semantic vector stage enters fusion at weight ${vectorWeight} and gives no score.`);
  }
  let vectorOutcome: VectorOutcome = skipVector ? 'off' : 'used';
  // The row as the model reads it: the same text shape its stored vectors were made from (embed/text.ts).
  const vectorText = embeddingText(input.rawName, 'query', embedder.textShape ?? 'folded');
  const columns = vectorColumnsFor(normalized.script, opts.vectorColumns ?? ['uz']);
  let queryVector: number[] | undefined;
  const vectorStage: Promise<Hit[]> = skipVector ? Promise.resolve([]) : timed(opts.timer, 'embed', () => embedder.embed([vectorText], 'query'))
    .then(([vec]) => {
      queryVector = vec;
      return vec ? timed(opts.timer, 'vector', () => searchColumns(retrieval, vec, limits.retrievalLimit, columns)) : [];
    })
    .catch((error: unknown) => {
      vectorOutcome = 'failed';
      notes.push(`Vector stage unavailable (${error instanceof Error ? error.message : String(error)}); using lexical retrieval only.`);
      return [] as Hit[];
    });

  // The numbers and brand spellings normalization strips for retrieval, searched
  // again so an identifying code ("15х2,5", "PANADOL 500mg N12") can be reached at all.
  // `retrieval` is the store limited to the row's TN VED heading when it has one (T4).
  const identifyingOn = !off('lexical') && opts.identifyingRetrieval !== false;
  const identifyingText = identifyingOn ? identifyingQuery(lexicalText, input.rawName) : null;
  // The same words again, selecting on the rare ones only: a brand in a handful
  // of codes ("ЭНАМ® Таблетки 5мг №100") is otherwise outranked by codes that
  // repeat the common words ("таблетки", "раствор для инфузий") more often.
  // Two-letter words come back here, which the lexical query drops: "ФЛУКОНАЗОЛ-RG" is told apart by its "RG".
  const shortWords = tokenize(normalized.matchKey).filter((w) => /^\p{L}{2}$/u.test(w));
  const anchoredText = [identifyingText ?? lexicalText, ...shortWords].join(' ').trim();
  const [lexical, fullText, vectorRaw, identifyingFirst, anchoredHits] = await Promise.all([
    off('lexical') ? Promise.resolve([] as Hit[]) : timed(opts.timer, 'lexical', () => retrieval.byLexical(lexicalText, limits.retrievalLimit)),
    off('lexical') ? Promise.resolve([] as Hit[]) : timed(opts.timer, 'fulltext', () => retrieval.byFullText(lexicalText, limits.retrievalLimit)),
    vectorStage,
    identifyingText === null ? Promise.resolve([] as Hit[]) : timed(opts.timer, 'fulltext', () => retrieval.byFullText(identifyingText, limits.retrievalLimit)),
    !identifyingOn || !anchoredText ? Promise.resolve([] as Hit[]) : timed(opts.timer, 'fulltext', () => retrieval.byFullText(anchoredText, limits.retrievalLimit, { anchored: true })),
  ]);
  const identifyingHits = mergeHits(identifyingFirst, anchoredHits);
  const vector = opts.vectorPerPosition === undefined
    ? vectorRaw
    : diversify(vectorRaw, (h) => h.candidate.subPositionCode, opts.vectorPerPosition);

  // Approved global aliases for this name (alias.ts): their codes, live and
  // inside the row's TN VED heading when it has one, form one more ranked list.
  const aliasHits: readonly AliasHit[] = normalized.sortedKey ? opts.aliases?.find(normalized.sortedKey) ?? [] : [];
  const aliasByCode = new Map(aliasHits.map((h) => [h.code, h]));
  const aliasCandidates: MxikCandidate[] = aliasHits.length === 0 ? [] : await timed(opts.timer, 'alias', async () => {
    const prefix = tnved.status === 'ok' && scoped ? headingPrefix(tnved.heading) : null;
    const live = await store.liveCodes(aliasHits.map((h) => h.code));
    const found = await Promise.all(aliasHits.filter((h) => live.has(h.code) && (prefix === null || h.code.startsWith(prefix))).map((h) => store.byCode(h.code)));
    return found.filter((c): c is MxikCandidate => c !== null);
  });
  if (aliasCandidates.length > 0) {
    notes.push(`Global alias: ${aliasCandidates.map((c) => `${c.code} (${aliasByCode.get(c.code)?.orgs ?? 0} organisations)`).join(', ')} confirmed for this name.`);
  }

  if (lexical.length === 0 && fullText.length === 0 && vector.length === 0 && identifyingHits.length === 0 && aliasCandidates.length === 0) {
    if (scoped) return unrestricted('no code of the heading was retrieved for this name');
    return {
      input, normalized, decidedBy: 'none', notes: [...notes, 'No candidate retrieved.'], candidates: [], pool: [],
      rerank: 'not_needed', vector: vectorOutcome, veto: null, tnved: tnvedOutcome,
    };
  }

  const productTokens = [...normalized.tokens, ...synonyms.added];
  const identity = opts.identifyingRule === false ? undefined : rowIdentity(input.rawName);
  /**
   * The words of this code's brand when the row names and earns it (identifying.ts), else none:
   * "ЭНАМ® Таблетки 5мг №100" and an ЭНАМ® 5 mg code.
   */
  const brandEarnedWords = (candidate: MxikCandidate): string[] => {
    if (identity === undefined || candidate.isBase) return [];
    const m = identifyingMatch(identity, candidate);
    return namesBrandOf(m) ? m.brandWords : [];
  };
  const brandEarned = (candidate: MxikCandidate): boolean => brandEarnedWords(candidate).length > 0;
  // Then the codes of other brands are the wrong product (rules.ts otherBrand); the most specific brand counts.
  const brandNamed = [...identifyingHits, ...lexical, ...fullText, ...vector]
    .map((h) => brandEarnedWords(h.candidate))
    .reduce<string[]>((best, words) => (words.length > best.length ? words : best), []);
  // The anchored hits of the row's own brand are a retrieval list of their own:
  // found only there, a brand code would have no fusion rank against codes every list repeats.
  const brandHits = anchoredHits.filter((h) => brandEarned(h.candidate));
  const head = opts.headNounRule === false || normalized.script !== 'cyrillic' ? null : rowHead(input.rawName);
  const headKey = head === null ? undefined : headStem(head);
  const ruleCache = new Map<string, RuleOutcome>();
  const rulesOf = (f: { item: MxikCandidate }): RuleOutcome => {
    const cached = ruleCache.get(f.item.code);
    if (cached) return cached;
    const outcome = applyRules({ candidate: f.item, rowUnit, catering, productTokens, identity, brandNamed, head: headKey });
    ruleCache.set(f.item.code, outcome);
    return outcome;
  };

  const lexicalScore = new Map(lexical.map((r) => [r.candidate.code, r.score]));
  // A semantic model's cosine is calibrated to the band it uses; the stand-in keeps (1 + cos) / 2,
  // the store's own score for a hit and the same fold of a cosine looked up by code.
  const vectorUnit = (cosine: number): number => (opts.vectorCalibration === null ? cosineToUnit(cosine) : vectorToUnit(cosine, opts.vectorCalibration));
  const vectorScore = new Map(standIn ? [] : vector.map((r) => [
    r.candidate.code,
    embedder.semantic && r.cosine !== undefined && opts.vectorCalibration !== null ? vectorToUnit(r.cosine, opts.vectorCalibration) : r.score,
  ]));
  // ts_rank_cd is unbounded; map it absolutely so a weak query's best hit is not 1.0.
  const fullTextScore = new Map(fullText.map((r) => [r.candidate.code, fullTextToUnit(r.score)]));
  // A pool code the vector stage did not return still has a cosine, looked up
  // by key. Without it the score renormalised over the lexical signals alone,
  // so an identifying code whose long leaf text shares one word with a generic
  // name (a drug's description, a first-aid kit for "Бинт") outranked the code
  // the model put first (2026-10-29, procurement names). Two kinds of code keep
  // the old treatment, because a long leaf is far from a short query whether or
  // not it is right: one the row earns by brand or size (rules.ts
  // identifyingPreferred), and the row's own code, which MISMATCH weighs
  // against the suggestions. Filling the trigram score the same way, for every
  // pool code or for its base codes, lost procurement rows and was left out;
  // only a base code basesForLeaves adds is scored on its own name. A failed
  // lookup leaves the signal absent.
  const ownCode = (input.existingMxik ?? '').replace(/\D/g, '');
  const fillVectorScores = async (pool: readonly { item: MxikCandidate }[]): Promise<void> => {
    const vec = queryVector;
    const lookup = retrieval.cosinesFor?.bind(retrieval);
    if (opts.vectorFill === false || !vec || !lookup || !embedder.semantic || standIn) return;
    const missing = pool
      .filter((f) => !vectorScore.has(f.item.code) && f.item.code !== ownCode && !rulesOf(f).keys.includes('identifyingPreferred'))
      .map((f) => f.item.code);
    if (missing.length === 0) return;
    try {
      const found = await timed(opts.timer, 'vector', () => Promise.all(columns.map((col) => lookup(vec, missing, col))));
      for (const code of missing) {
        const cosines = found.map((m) => m.get(code)).filter((c) => c !== undefined);
        if (cosines.length > 0) vectorScore.set(code, vectorUnit(Math.max(...cosines)));
      }
    } catch (error) {
      notes.push(`Vector scores for the pool unavailable (${error instanceof Error ? error.message : String(error)}).`);
    }
  };
  // A generic name ("Реле защитное", "Водяной насос") reaches the right
  // subposition through its identifying codes ("Реле всех видов, Реле времени
  // PO-415, ...") while the subposition's base code, the sanctioned answer when
  // the name gives no brand or size, never makes a list: its short name loses
  // the trigram and vector slots to the many leaves. When the pool holds leaves
  // of a subposition and the row earns none of them (rules.ts
  // identifyingPreferred), the base code joins the pool, scored on its own name
  // and ranked in fusion like its best leaf; the shape rules then weigh it
  // against them (2026-10-29, procurement names). Only for a name without a
  // digit: a size, grade, dose or pack makes an identifying code the likely
  // answer (the metal list lost top-5 cases when sized rows got the base too).
  // Not for a food-service row: its answers are the catering family codes, and
  // the group's base codes are other families.
  const basesForLeaves = async (pool: readonly FusedCandidate[]): Promise<FusedCandidate[]> => {
    if (opts.baseForLeaves === false || catering || /\d/.test(input.rawName)) return [];
    const inPool = new Set(pool.map((f) => f.item.code));
    const leavesOf = new Map<string, FusedCandidate[]>();
    for (const f of pool) {
      if (f.item.isBase) continue;
      const leaves = leavesOf.get(f.item.subPositionCode) ?? [];
      leaves.push(f);
      leavesOf.set(f.item.subPositionCode, leaves);
    }
    const wanted = [...leavesOf]
      .filter(([sub, leaves]) => !inPool.has(`${sub}${BASE_SUFFIX}`) && !leaves.some((f) => rulesOf(f).keys.includes('identifyingPreferred')))
      .map(([sub]) => `${sub}${BASE_SUFFIX}`);
    if (wanted.length === 0) return [];
    try {
      const [found, live, trigram] = await Promise.all([
        Promise.all(wanted.map((code) => store.byCode(code))),
        store.liveCodes(wanted),
        store.lexicalFor ? store.lexicalFor(lexicalText, wanted) : new Map<string, number>(),
      ]);
      // The base's own name is scored, not its leaves': a leaf's brand or
      // attribute words ("..., Фотометры медицинского назначения (ИФА)" under
      // "прочие" medical apparatus) are no evidence for the catch-all base.
      // Only the fusion rank is the subposition's, its best leaf's.
      const bases = found.filter((c): c is MxikCandidate => c !== null && c.isBase && live.has(c.code)).map((base) => {
        const lexical = trigram.get(base.code);
        if (lexical !== undefined) lexicalScore.set(base.code, lexical);
        const leaves = leavesOf.get(base.subPositionCode) ?? [];
        return { item: base, score: 0, normalized: Math.max(...leaves.map((f) => f.normalized)), ranks: {} };
      });
      await fillVectorScores(bases);
      return bases;
    } catch (error) {
      notes.push(`Base codes for the pool unavailable (${error instanceof Error ? error.message : String(error)}).`);
      return [];
    }
  };
  // Counts only for codes the row earns (rules.ts identifyingPreferred): the
  // query's numbers are evidence for those, noise for every other code.
  const identifyingScore = new Map(identifyingHits.map((r) => [r.candidate.code, fullTextToUnit(r.score)]));
  const hierarchyWords = new Map(fullText.map((r) => [r.candidate.code, r.hierarchyWords ?? []]));

  // ------------------------------------------------------------- 5. fusion
  // The alias list exists only when an alias matched, so an empty lexicon
  // leaves the fusion (and its normalisation) exactly as before.
  const lists = [
    { name: 'lexical', items: lexical.map((r) => r.candidate) },
    { name: 'fullText', items: fullText.map((r) => r.candidate) },
    { name: 'vector', items: vector.map((r) => r.candidate), weight: vectorWeight },
    { name: 'brand', items: brandHits.map((r) => r.candidate) },
    ...(aliasCandidates.length > 0 ? [{ name: 'alias', items: aliasCandidates }] : []),
  ];
  const fusedAll = reciprocalRankFusion(lists, (c) => c.code);
  // A size alone does not say which heading: "57х3,5" is also a 7305 "other
  // tubes" code. The identifying query may add or lift a code on its size only
  // inside a subposition of the three leading fused codes; a matched brand may
  // bring its code from anywhere ("PANADOL" is nowhere among "tabletka" codes).
  const leading = new Set(fusedAll.slice(0, 3).map((f) => f.item.subPositionCode));
  const earnsIdentifying = (f: { item: MxikCandidate }): boolean => {
    const rules = rulesOf(f);
    return rules.keys.includes('identifyingPreferred') && (rules.identifyingBrand || leading.has(f.item.subPositionCode));
  };
  // Second pass per position: the group whose codes fill the lists (plan §3.2).
  const positionMode = opts.positionFusion ?? 'off';
  // A non-semantic stand-in finds surface-form neighbours; it does not vote on positions (plan §5).
  const positionLists = embedder.semantic ? lists : lists.filter((l) => l.name !== 'vector');
  const positionScore = positionMode === 'off' ? null : groupFusion(positionLists, groupKey[positionMode], undefined, opts.positionFusionCap);

  const retrievalSignals = (f: (typeof fusedAll)[number]) => {
    const code = f.item.code;
    // Stage 3 is trigram + full-text; take whichever channel found it best.
    const lex = lexicalScore.get(code);
    const identifying = earnsIdentifying(f) ? identifyingScore.get(code) : undefined;
    const fts = identifying === undefined ? fullTextScore.get(code) : Math.max(fullTextScore.get(code) ?? 0, identifying);
    return {
      lexical: lex === undefined && fts === undefined ? undefined : Math.max(lex ?? 0, fts ?? 0),
      vector: vectorScore.get(code),
      rrf: f.normalized,
      positionRrf: positionMode === 'off' ? undefined : positionScore?.get(groupKey[positionMode](f.item)) ?? 0,
    };
  };
  const gateScore = (f: (typeof fusedAll)[number]): number =>
    adjustedScore({ signals: retrievalSignals(f), rerankAvailable: true, adjustment: rulesOf(f).adjustment, weights: opts.weights });

  // The reranker's pool: a few codes per subposition and several subpositions,
  // so it can choose a position, not only a size (fusion.ts positionPool). The
  // codes a subposition keeps are its best by rules-adjusted score.
  const perPosition = opts.poolPerPosition === undefined ? DEFAULTS.poolPerPosition : opts.poolPerPosition;
  const diverse = perPosition === null
    ? fusedAll.slice(0, limits.rerankLimit)
    : positionPool(fusedAll, (f) => f.item.subPositionCode, {
      limit: limits.rerankLimit, cap: perPosition, minGroups: opts.poolMinPositions ?? DEFAULTS.poolMinPositions, keep: gateScore,
    });
  // Identifying codes the name lists ranked too low, or never found: the best
  // few the row earns (rules.ts identifyingPreferred) join the pool, after it.
  const inWindow = new Set(diverse.map((f) => f.item.code));
  const fusedByCode = new Map(fusedAll.map((f) => [f.item.code, f]));
  const added = identifyingHits
    .filter((h) => !inWindow.has(h.candidate.code))
    .map((h, i) => fusedByCode.get(h.candidate.code) ?? { item: h.candidate, score: 0, normalized: 0, ranks: { identifying: i + 1 } })
    .filter(earnsIdentifying)
    .slice(0, IDENTIFYING_SLOTS);
  const window = [...diverse, ...added];
  await fillVectorScores(window);
  const bases = await basesForLeaves(window);
  // Alias codes the fused window left out still reach the pool, after it:
  // several organisations stood behind them, so the reranker should see them.
  const pooled = new Set([...window, ...bases].map((f) => f.item.code));
  const aliasAdded = aliasCandidates
    .filter((c) => !pooled.has(c.code))
    .flatMap((c) => { const f = fusedByCode.get(c.code); return f ? [f] : []; })
    .slice(0, ALIAS_SLOTS);
  const fused = [...window, ...bases, ...aliasAdded];
  notes.push(poolNote(fused.map((f) => f.item), fusedAll.slice(0, limits.rerankLimit).map((f) => f.item.code)));
  if (bases.length > 0) notes.push(`Base code added for ${bases.map((b) => b.item.subPositionCode).join(', ')}: the pool held only identifying codes the name does not earn.`);

  // ------------------------------------------------------------- 6. rerank
  const step = await rerankStep({
    reranker,
    store,
    gate: opts.rerankGate,
    gateScores: fused.map(gateScore),
    request: { productName: normalized.display, normalizedKey: normalized.matchKey, unit: rowUnit, candidates: fused.map((f) => f.item) },
    run: (fn) => timed(opts.timer, 'rerank', fn),
  });
  notes.push(...step.notes);
  const llmScore = step.scores;
  const rerankNone = step.outcome === 'none';

  // ------------------------------------------------------------ calibration
  // Every candidate is ranked by its adjusted score; only the leader earns the
  // margin bonus, everyone else is shaped as a dead heat (score.ts). The
  // no-reranker cap is lifted only for candidates the reranker actually scored,
  // so a failed or skipped call can never push a retrieval-only guess into the
  // bulk-accept band.
  const pool = fused.map((f) => ({ fused: f, signals: { ...retrievalSignals(f), llm: llmScore.get(f.item.code)?.confidence ?? step.unranked }, rules: rulesOf(f) }));
  const poolScores = calibratePool(pool.map((p) => ({
    signals: p.signals, rerankAvailable: llmScore.has(p.fused.item.code), adjustment: p.rules.adjustment, weights: opts.weights,
  })));
  const ranked = pool
    .map((p, i) => ({ ...p, score: poolScores[i] ?? { adjusted: 0, confidence: 0 } }))
    .sort((a, b) => b.score.adjusted - a.score.adjusted);

  const scored: ScoredCandidate[] = ranked.map((p, index): ScoredCandidate => {
    const llm = llmScore.get(p.fused.item.code);
    const stage = llm ? 'rerank' : 'fusion';
    return {
      candidate: p.fused.item,
      signals: p.signals,
      ranks: {
        lexical: p.fused.ranks['lexical'] ?? p.fused.ranks['fullText'],
        vector: p.fused.ranks['vector'],
        fusion: index + 1,
      },
      confidence: p.score.confidence,
      band: bandOf(p.score.confidence),
      reason: llm?.reason ?? describeMatch(p.fused.item, p.signals.lexical),
      stage,
      adjustments: p.rules.notes,
      evidence: evidenceFor({
        stage,
        productName: input.rawName,
        rowUnit,
        candidate: p.fused.item,
        rerankReason: llm && !rerankNone ? llm.reason : null,
        rerankNone,
        rules: p.rules.keys,
        synonyms,
        hierarchyWords: hierarchyWords.get(p.fused.item.code),
        identifyingTokens: p.rules.identifyingTokens,
        alias: aliasByCode.get(p.fused.item.code),
      }),
    };
  }).sort((a, b) => b.confidence - a.confidence);

  // A missing suggestion beats a wrong one: drop weak candidates that share no word with the product.
  const kept = scored.filter((c) => !isUnrelated(input.rawName, c.candidate, c.confidence, synonyms.added));
  if (!rerankNone && kept.length < scored.length) notes.push(`${scored.length - kept.length} unrelated low-confidence candidate(s) hidden.`);
  // A reranker veto is a judgement on the heading's codes and stands; an empty list without one is the heading's failure.
  if (scoped && !rerankNone && kept.length === 0) return unrestricted('every retrieved code of the heading was unrelated to the name');

  return {
    input, normalized, notes,
    decidedBy: kept.length === 0 ? 'none' : step.outcome === 'ranked' ? 'rerank' : 'fusion',
    pool: ranked.map((x) => x.fused.item.code),
    candidates: kept.slice(0, limits.topK),
    rerank: step.outcome,
    vector: vectorOutcome,
    veto: rerankNone ? { offered: fused.map((f) => f.item.code) } : null,
    tnved: tnvedOutcome,
  };
}

/** Two hit lists as one, each code once at its better score, best first. */
export function mergeHits<T extends { candidate: MxikCandidate; score: number }>(a: readonly T[], b: readonly T[]): T[] {
  if (b.length === 0) return [...a];
  const best = new Map<string, T>();
  for (const hit of [...a, ...b]) {
    const seen = best.get(hit.candidate.code);
    if (!seen || hit.score > seen.score) best.set(hit.candidate.code, hit);
  }
  return [...best.values()].sort((x, y) => y.score - x.score || x.candidate.code.localeCompare(y.candidate.code));
}

/** Fallback explanation when no reranker supplied one. */
function describeMatch(candidate: MxikCandidate, lexical: number | undefined): string {
  const path = hierarchyPath(candidate);
  const strength = lexical === undefined ? 'related' : lexical >= 0.8 ? 'a close' : lexical >= 0.5 ? 'a partial' : 'a weak';
  const kind = candidate.isBase ? 'base code' : 'identifying code';
  return `${strength} name match against this ${kind}${path ? ` under ${path}` : ''}.`;
}
