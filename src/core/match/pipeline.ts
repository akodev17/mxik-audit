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
import { reciprocalRankFusion } from './fusion.js';
import type { RerankGate } from './rerank-config.js';
import { rerankStep } from './rerank-step.js';
import { evidenceFor } from './evidence.js';
import { lexicalQuery } from './query.js';
import { isUnrelated } from './relevance.js';
import { applyRules, hierarchyPath, isPreparedDish } from './rules.js';
import { adjustedScore, bandOf, calibratePool, fullTextToUnit } from './score.js';
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
  type Hit = { candidate: MxikCandidate; score: number };
  let vectorOutcome: VectorOutcome = off('vector') ? 'off' : 'used';
  const vectorStage: Promise<Hit[]> = off('vector') ? Promise.resolve([]) : timed(opts.timer, 'embed', () => embedder.embed([query]))
    .then(([vec]) => (vec ? timed(opts.timer, 'vector', () => store.byVector(vec, limits.retrievalLimit)) : []))
    .catch((error: unknown) => {
      vectorOutcome = 'failed';
      notes.push(`Vector stage unavailable (${error instanceof Error ? error.message : String(error)}); using lexical retrieval only.`);
      return [] as Hit[];
    });

  const [lexical, fullText, vector] = await Promise.all([
    off('lexical') ? Promise.resolve([] as Hit[]) : timed(opts.timer, 'lexical', () => store.byLexical(lexicalText, limits.retrievalLimit)),
    off('lexical') ? Promise.resolve([] as Hit[]) : timed(opts.timer, 'fulltext', () => store.byFullText(lexicalText, limits.retrievalLimit)),
    vectorStage,
  ]);

  if (lexical.length === 0 && fullText.length === 0 && vector.length === 0) {
    return {
      input, normalized, decidedBy: 'none', notes: [...notes, 'No candidate retrieved.'], candidates: [], pool: [],
      rerank: 'not_needed', vector: vectorOutcome, veto: null,
    };
  }

  const lexicalScore = new Map(lexical.map((r) => [r.candidate.code, r.score]));
  const vectorScore = new Map(vector.map((r) => [r.candidate.code, r.score]));
  // ts_rank_cd is unbounded; map it absolutely so a weak query's best hit is not 1.0.
  const fullTextScore = new Map(fullText.map((r) => [r.candidate.code, fullTextToUnit(r.score)]));

  // ------------------------------------------------------------- 5. fusion
  const fused = reciprocalRankFusion(
    [
      { name: 'lexical', items: lexical.map((r) => r.candidate) },
      { name: 'fullText', items: fullText.map((r) => r.candidate) },
      { name: 'vector', items: vector.map((r) => r.candidate) },
    ],
    (c) => c.code,
  ).slice(0, limits.rerankLimit);

  const retrievalSignals = (f: (typeof fused)[number]) => {
    const code = f.item.code;
    // Stage 3 is trigram + full-text; take whichever channel found it best.
    const lex = lexicalScore.get(code);
    const fts = fullTextScore.get(code);
    return {
      lexical: lex === undefined && fts === undefined ? undefined : Math.max(lex ?? 0, fts ?? 0),
      vector: vectorScore.get(code),
      rrf: f.normalized,
    };
  };
  const rulesOf = (f: (typeof fused)[number]) => applyRules({ candidate: f.item, rowUnit, preparedDish });

  // ------------------------------------------------------------- 6. rerank
  const step = await rerankStep({
    reranker,
    store,
    gate: opts.rerankGate,
    gateScores: fused.map((f) => adjustedScore({ signals: retrievalSignals(f), rerankAvailable: true, adjustment: rulesOf(f).adjustment })),
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
    signals: p.signals, rerankAvailable: p.signals.llm !== undefined, adjustment: p.rules.adjustment,
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
