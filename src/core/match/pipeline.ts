// The ordered cascade. First strong hit wins, but the top five are always
// returned so the reviewer has alternatives.
//
//   1 barcode exact      confidence 1.00
//   2 folded name exact  confidence 0.95
//   3 lexical (trigram)  |
//   4 vector (pgvector)  |-> 5 reciprocal rank fusion -> 6 LLM rerank
import { normalizeBarcode, normalizeName } from '../normalize/index.js';
import { reciprocalRankFusion } from './fusion.js';
import type { RerankGate } from './rerank-config.js';
import { rerankGate } from './rerank-gate.js';
import { applyRules, hierarchyPath, isPreparedDish } from './rules.js';
import { bandOf, calibrate } from './score.js';
import type {
  CandidateStore, EmbeddingProvider, MatchInput, MatchResult,
  MxikCandidate, RerankProvider, RerankVerdict, ScoredCandidate,
} from './types.js';

export type PipelineOptions = {
  store: CandidateStore;
  embedder: EmbeddingProvider;
  reranker: RerankProvider;
  /** Only rows this gate calls uncertain go to the reranker. Absent = all fused rows. */
  rerankGate?: RerankGate | undefined;
  /** How many rows each retrieval stage pulls. */
  retrievalLimit?: number;
  /** How many fused candidates go to the reranker. */
  rerankLimit?: number;
  /** How many results to return. */
  topK?: number;
};

const DEFAULTS = { retrievalLimit: 50, rerankLimit: 20, topK: 5 } as const;

/** Wraps a definite hit from stages 1-2, which bypass scoring. */
function certain(
  candidate: MxikCandidate,
  confidence: number,
  stage: 'barcode' | 'exact',
  reason: string,
  rowUnit: string | null,
  preparedDish: boolean,
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
  };
}

export async function matchProduct(input: MatchInput, opts: PipelineOptions): Promise<MatchResult> {
  const limits = { ...DEFAULTS, ...opts };
  const { store, embedder, reranker } = opts;
  const notes: string[] = [];
  const normalized = normalizeName(input.rawName);
  const preparedDish = isPreparedDish(input.rawName);
  const rowUnit = input.unit ?? null;

  if (preparedDish) notes.push('Detected as a prepared dish; general codes preferred.');
  if (!embedder.semantic) notes.push(`Vector stage is using "${embedder.name}" — surface-form only, not semantic.`);
  if (!reranker.available) notes.push(`Reranker unavailable (${reranker.name}); confidence is capped.`);

  // ---------------------------------------------------------------- 1. barcode
  const barcode = normalizeBarcode(input.barcode);
  if (barcode) {
    const hits = await store.byBarcode(barcode);
    if (hits.length === 1 && hits[0]) {
      return {
        input, normalized, decidedBy: 'barcode', notes, pool: [hits[0].code],
        candidates: [certain(hits[0], 1, 'barcode', `Barcode ${barcode} matches this code exactly in the classifier.`, rowUnit, preparedDish)],
      };
    }
    if (hits.length > 1) {
      notes.push(`Barcode ${barcode} maps to ${hits.length} codes; falling through to name matching.`);
    }
  } else if (input.barcode) {
    notes.push(`Barcode "${input.barcode}" is not a valid GTIN length; ignored.`);
  }

  // ---------------------------------------------------------- 2. folded exact
  if (normalized.matchKey) {
    const exact = await store.byMatchKey([normalized.matchKey, normalized.sortedKey]);
    if (exact.length === 1 && exact[0]) {
      return {
        input, normalized, decidedBy: 'exact', notes, pool: [exact[0].code],
        candidates: [certain(exact[0], 0.95, 'exact', 'Product name matches this classifier entry exactly after normalization.', rowUnit, preparedDish)],
      };
    }
    if (exact.length > 1) notes.push(`${exact.length} codes share this normalized name; ranking them.`);
  }

  // -------------------------------------------------- 3+4. lexical and vector
  const query = normalized.queryKey || normalized.matchKey || normalized.core;
  // The vector stage must not be able to take down the audit: a provider outage
  // or an exhausted quota degrades retrieval to lexical rather than throwing.
  const vectorStage = embedder
    .embed([query])
    .then(([vec]) => (vec ? store.byVector(vec, limits.retrievalLimit) : []))
    .catch((error: unknown) => {
      notes.push(`Vector stage unavailable (${error instanceof Error ? error.message : String(error)}); using lexical retrieval only.`);
      return [] as { candidate: MxikCandidate; score: number }[];
    });

  const [lexical, fullText, vector] = await Promise.all([
    store.byLexical(query, limits.retrievalLimit),
    store.byFullText(query, limits.retrievalLimit),
    vectorStage,
  ]);

  if (lexical.length === 0 && fullText.length === 0 && vector.length === 0) {
    return { input, normalized, decidedBy: 'none', notes: [...notes, 'No candidate retrieved.'], candidates: [], pool: [] };
  }

  const lexicalScore = new Map(lexical.map((r) => [r.candidate.code, r.score]));
  const vectorScore = new Map(vector.map((r) => [r.candidate.code, r.score]));
  // ts_rank_cd is unbounded, so normalize against the best hit in this result set.
  const bestFullText = Math.max(...fullText.map((r) => r.score), 0);
  const fullTextScore = new Map(
    fullText.map((r) => [r.candidate.code, bestFullText > 0 ? r.score / bestFullText : 0]),
  );

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

  // ------------------------------------------------------------- 6. rerank
  const llmScore = new Map<string, { confidence: number; reason: string }>();
  let decidedBy: MatchResult['decidedBy'] = 'fusion';
  if (reranker.available && fused.length > 0) {
    // The gate reads uncapped retrieval confidence; skipping never lifts the cap.
    const gate = rerankGate(
      fused.map((f) => calibrate({
        signals: retrievalSignals(f),
        rerankAvailable: true,
        adjustment: applyRules({ candidate: f.item, rowUnit, preparedDish }).adjustment,
      })),
      opts.rerankGate,
    );
    if (!gate.rerank) {
      notes.push(`Reranker skipped (${gate.reason}); confidence is capped.`);
    } else {
      try {
        const verdicts = await reranker.rerank({
          productName: normalized.display,
          normalizedKey: normalized.matchKey,
          unit: rowUnit,
          preparedDish,
          candidates: fused.map((f) => f.item),
        });
        const valid = await keepKnownCodes(verdicts, fused.map((f) => f.item.code), store);
        if (valid.length < verdicts.length) {
          notes.push(`Reranker returned ${verdicts.length - valid.length} code(s) outside the candidates or the classifier; discarded.`);
        }
        for (const v of valid) llmScore.set(v.code, { confidence: v.confidence, reason: v.reason });
        if (valid.length > 0) decidedBy = 'rerank';
      } catch (error) {
        notes.push(`Reranker failed (${error instanceof Error ? error.message : String(error)}); falling back to fusion order.`);
      }
    }
  }

  // ------------------------------------------------------------ calibration
  // Two passes: score everything, then re-score with the runner-up known so the
  // margin bonus reflects the real gap. The no-reranker cap is lifted only for
  // candidates the reranker actually scored, so a failed or skipped call can
  // never push a retrieval-only guess into the bulk-accept band.
  const provisional = fused.map((f) => {
    const signals = { ...retrievalSignals(f), llm: llmScore.get(f.item.code)?.confidence };
    const rules = applyRules({ candidate: f.item, rowUnit, preparedDish });
    return { fused: f, signals, rules, bare: calibrate({ signals, rerankAvailable: signals.llm !== undefined }) };
  }).sort((a, b) => b.bare - a.bare);

  const runnerUp = provisional[1]?.bare;

  const scored: ScoredCandidate[] = provisional.map((p, index): ScoredCandidate => {
    const code = p.fused.item.code;
    const confidence = calibrate({
      signals: p.signals,
      runnerUp: index === 0 ? runnerUp : undefined,
      rerankAvailable: p.signals.llm !== undefined,
      adjustment: p.rules.adjustment,
    });
    const llm = llmScore.get(code);
    return {
      candidate: p.fused.item,
      signals: p.signals,
      ranks: {
        lexical: p.fused.ranks['lexical'] ?? p.fused.ranks['fullText'],
        vector: p.fused.ranks['vector'],
        fusion: index + 1,
      },
      confidence,
      band: bandOf(confidence),
      reason: llm?.reason ?? describeMatch(p.fused.item, p.signals.lexical),
      stage: llm ? 'rerank' : 'fusion',
      adjustments: p.rules.notes,
    };
  }).sort((a, b) => b.confidence - a.confidence);

  return {
    input, normalized, decidedBy, notes,
    pool: provisional.map((x) => x.fused.item.code),
    candidates: scored.slice(0, limits.topK),
  };
}

/** Drops any verdict whose code was not offered or is not a live classifier code. */
async function keepKnownCodes(
  verdicts: readonly RerankVerdict[],
  offered: readonly string[],
  store: CandidateStore,
): Promise<RerankVerdict[]> {
  const allowed = new Set(offered);
  const inPool = verdicts.filter((v) => allowed.has(v.code));
  if (inPool.length === 0) return [];
  const live = await store.liveCodes(inPool.map((v) => v.code));
  return inPool.filter((v) => live.has(v.code));
}

/** Fallback explanation when no reranker supplied one. */
function describeMatch(candidate: MxikCandidate, lexical: number | undefined): string {
  const path = hierarchyPath(candidate);
  const strength = lexical === undefined ? 'related' : lexical >= 0.8 ? 'a close' : lexical >= 0.5 ? 'a partial' : 'a weak';
  const kind = candidate.isBase ? 'base code' : 'identifying code';
  return `${strength} name match against this ${kind}${path ? ` under ${path}` : ''}.`;
}
