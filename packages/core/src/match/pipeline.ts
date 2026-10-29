// The ordered cascade. First strong hit wins, but the top five are always
// returned so the reviewer has alternatives.
//
//   1 barcode exact      confidence 1.00
//   2 folded name exact  confidence 0.95
//   3 lexical (trigram)  |
//   4 vector (pgvector)  |-> 5 reciprocal rank fusion -> 6 LLM rerank
import { barcodeIdentity, normalizeName, type BarcodeIdentity } from '../normalize/index.js';
import { applySynonyms } from '../normalize/synonyms.js';
import { dictionaryKeys, type DictionaryEntry, type DictionaryLookup } from './dictionary.js';
import { NoopRerankProvider } from './rerank.js';
import { diversify, groupFusion, reciprocalRankFusion } from './fusion.js';
import type { RerankGate } from './rerank-config.js';
import { rerankStep } from './rerank-step.js';
import { evidenceFor } from './evidence.js';
import { lexicalQuery } from './query.js';
import { isUnrelated } from './relevance.js';
import { applyRules, hierarchyPath, isPreparedDish } from './rules.js';
import { adjustedScore, bandOf, calibratePool, fullTextToUnit, vectorToUnit, type SignalWeights, type VectorCalibration } from './score.js';
import type { VectorColumn } from './vector-readiness.js';
import { embeddingText } from '../embed/text.js';
import type { ScriptKind } from '../normalize/index.js';
import type {
  CandidateStore, EmbeddingProvider, MatchInput, MatchResult, MxikCandidate,
  RerankProvider, ScoredCandidate, VectorOutcome,
} from './types.js';

export type PipelineOptions = {
  store: CandidateStore;
  embedder: EmbeddingProvider;
  reranker: RerankProvider;
  /** What this org confirmed before; checked first and ranked above everything else. */
  dictionary?: DictionaryLookup | undefined;
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

const DEFAULTS = { retrievalLimit: 50, rerankLimit: 20, topK: 5 } as const;

/** Wraps a definite hit from stages 1-2, which bypass scoring. */
function certain(
  candidate: MxikCandidate,
  confidence: number,
  stage: 'barcode' | 'exact',
  reason: string,
  rowUnit: string | null,
  preparedDish: boolean,
  productName: string,
): ScoredCandidate {
  const rules = applyRules({ candidate, rowUnit, preparedDish });
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
      dictionaryEntryId: hit.id,
      ...(hit.hold ? { dictionaryHold: hit.hold } : {}),
    },
  };
}

/** Stage 0: the firm dictionary, then the normal cascade for the alternatives. */
export async function matchProduct(input: MatchInput, opts: PipelineOptions): Promise<MatchResult> {
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
  const preparedDish = isPreparedDish(input.rawName);
  const rowUnit = input.unit ?? null;
  const off = (stage: DisableableStage): boolean => opts.disabledStages?.has(stage) ?? false;
  const settled = { rerank: 'not_needed', vector: 'not_needed', veto: null } as const;

  if (preparedDish) notes.push('Detected as a prepared dish; general codes preferred.');
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
          candidates: [certain(hits[0], 1, 'barcode', `Barcode ${barcode} matches this code exactly in the classifier.`, rowUnit, preparedDish, input.rawName)],
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
    const exact = await timed(opts.timer, 'exact', () => store.byMatchKey(keys));
    if (exact.length === 1 && exact[0]) {
      return {
        input, normalized, decidedBy: 'exact', notes, pool: [exact[0].code], ...settled,
        candidates: [certain(exact[0], 0.95, 'exact', 'Product name matches this classifier entry exactly after normalization.', rowUnit, preparedDish, input.rawName)],
      };
    }
    if (exact.length > 1) notes.push(`${exact.length} codes share this normalized name; ranking them.`);
  }

  // -------------------------------------------------- 3+4. lexical and vector
  const query = normalized.queryKey || normalized.matchKey || normalized.core;
  // Synonyms reach the lexical query only; the vector stage embeds the row as written.
  const synonyms = applySynonyms(query);
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
  const vectorStage: Promise<Hit[]> = skipVector ? Promise.resolve([]) : timed(opts.timer, 'embed', () => embedder.embed([vectorText], 'query'))
    .then(([vec]) => (vec ? timed(opts.timer, 'vector', () => searchColumns(store, vec, limits.retrievalLimit, columns)) : []))
    .catch((error: unknown) => {
      vectorOutcome = 'failed';
      notes.push(`Vector stage unavailable (${error instanceof Error ? error.message : String(error)}); using lexical retrieval only.`);
      return [] as Hit[];
    });

  const [lexical, fullText, vectorRaw] = await Promise.all([
    off('lexical') ? Promise.resolve([] as Hit[]) : timed(opts.timer, 'lexical', () => store.byLexical(lexicalText, limits.retrievalLimit)),
    off('lexical') ? Promise.resolve([] as Hit[]) : timed(opts.timer, 'fulltext', () => store.byFullText(lexicalText, limits.retrievalLimit)),
    vectorStage,
  ]);
  const vector = opts.vectorPerPosition === undefined
    ? vectorRaw
    : diversify(vectorRaw, (h) => h.candidate.subPositionCode, opts.vectorPerPosition);

  if (lexical.length === 0 && fullText.length === 0 && vector.length === 0) {
    return {
      input, normalized, decidedBy: 'none', notes: [...notes, 'No candidate retrieved.'], candidates: [], pool: [],
      rerank: 'not_needed', vector: vectorOutcome, veto: null,
    };
  }

  const lexicalScore = new Map(lexical.map((r) => [r.candidate.code, r.score]));
  // A semantic model's cosine is calibrated to the band it uses; the stand-in keeps (1 + cos) / 2.
  const vectorScore = new Map(standIn ? [] : vector.map((r) => [
    r.candidate.code,
    embedder.semantic && r.cosine !== undefined && opts.vectorCalibration !== null ? vectorToUnit(r.cosine, opts.vectorCalibration) : r.score,
  ]));
  // ts_rank_cd is unbounded; map it absolutely so a weak query's best hit is not 1.0.
  const fullTextScore = new Map(fullText.map((r) => [r.candidate.code, fullTextToUnit(r.score)]));
  const hierarchyWords = new Map(fullText.map((r) => [r.candidate.code, r.hierarchyWords ?? []]));

  // ------------------------------------------------------------- 5. fusion
  const lists = [
    { name: 'lexical', items: lexical.map((r) => r.candidate) },
    { name: 'fullText', items: fullText.map((r) => r.candidate) },
    { name: 'vector', items: vector.map((r) => r.candidate), weight: vectorWeight },
  ];
  const fused = reciprocalRankFusion(lists, (c) => c.code).slice(0, limits.rerankLimit);
  // Second pass per position: the group whose codes fill the lists (plan §3.2).
  const positionMode = opts.positionFusion ?? 'off';
  // A non-semantic stand-in finds surface-form neighbours; it does not vote on positions (plan §5).
  const positionLists = embedder.semantic ? lists : lists.filter((l) => l.name !== 'vector');
  const positionScore = positionMode === 'off' ? null : groupFusion(positionLists, groupKey[positionMode], undefined, opts.positionFusionCap);

  const retrievalSignals = (f: (typeof fused)[number]) => {
    const code = f.item.code;
    // Stage 3 is trigram + full-text; take whichever channel found it best.
    const lex = lexicalScore.get(code);
    const fts = fullTextScore.get(code);
    return {
      lexical: lex === undefined && fts === undefined ? undefined : Math.max(lex ?? 0, fts ?? 0),
      vector: vectorScore.get(code),
      rrf: f.normalized,
      positionRrf: positionMode === 'off' ? undefined : positionScore?.get(groupKey[positionMode](f.item)) ?? 0,
    };
  };
  const productTokens = [...normalized.tokens, ...synonyms.added];
  const rulesOf = (f: (typeof fused)[number]) => applyRules({ candidate: f.item, rowUnit, preparedDish, productTokens });

  // ------------------------------------------------------------- 6. rerank
  const step = await rerankStep({
    reranker,
    store,
    gate: opts.rerankGate,
    gateScores: fused.map((f) => adjustedScore({ signals: retrievalSignals(f), rerankAvailable: true, adjustment: rulesOf(f).adjustment, weights: opts.weights })),
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
  const pool = fused.map((f) => ({ fused: f, signals: { ...retrievalSignals(f), llm: llmScore.get(f.item.code)?.confidence }, rules: rulesOf(f) }));
  const poolScores = calibratePool(pool.map((p) => ({
    signals: p.signals, rerankAvailable: p.signals.llm !== undefined, adjustment: p.rules.adjustment, weights: opts.weights,
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
      }),
    };
  }).sort((a, b) => b.confidence - a.confidence);

  // A missing suggestion beats a wrong one: drop weak candidates that share no word with the product.
  const kept = rerankNone ? [] : scored.filter((c) => !isUnrelated(input.rawName, c.candidate, c.confidence, synonyms.added));
  if (!rerankNone && kept.length < scored.length) notes.push(`${scored.length - kept.length} unrelated low-confidence candidate(s) hidden.`);

  return {
    input, normalized, notes,
    decidedBy: kept.length === 0 ? 'none' : step.outcome === 'ranked' ? 'rerank' : 'fusion',
    pool: ranked.map((x) => x.fused.item.code),
    candidates: kept.slice(0, limits.topK),
    rerank: step.outcome,
    vector: vectorOutcome,
    veto: rerankNone ? { offered: fused.map((f) => f.item.code) } : null,
  };
}

/** Fallback explanation when no reranker supplied one. */
function describeMatch(candidate: MxikCandidate, lexical: number | undefined): string {
  const path = hierarchyPath(candidate);
  const strength = lexical === undefined ? 'related' : lexical >= 0.8 ? 'a close' : lexical >= 0.5 ? 'a partial' : 'a weak';
  const kind = candidate.isBase ? 'base code' : 'identifying code';
  return `${strength} name match against this ${kind}${path ? ` under ${path}` : ''}.`;
}
