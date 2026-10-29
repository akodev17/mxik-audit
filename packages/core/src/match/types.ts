import type { NormalizedName } from '../normalize/index.js';
import type { MatchEvidence } from './evidence.js';
import type { EmbedRole, TextShape } from '../embed/text.js';

/** Which pipeline stage produced or last touched a candidate. */
export type MatchStage = 'barcode' | 'exact' | 'lexical' | 'vector' | 'fusion' | 'rerank' | 'dictionary' | 'none';

export type ConfidenceBand = 'high' | 'medium' | 'low';

/** A classifier row, carrying everything the reranker and the UI need. */
export type MxikCandidate = {
  code: string;
  nameUz: string;
  nameRu: string;
  groupName: string | null;
  className: string | null;
  positionName: string | null;
  subPositionName: string | null;
  brandName: string | null;
  attributeName: string | null;
  subPositionCode: string;
  isBase: boolean;
  /** Null for the 8.7% of codes where the portal leaves `label` unset. */
  isMarked: boolean | null;
  unitBinding: 'strict' | 'recommended' | 'none';
  unitCanonical: string[];
  /** Units the portal recommends (columns M/N); the only units a 'recommended' binding has. */
  recommendedUnits?: string[];
  unitRaw: string | null;
  /** Packaging qualifier parsed out of the bound unit, e.g. "pэt butilka". */
  unitContainer: string | null;
  barcode: string | null;
};

/** Raw per-stage signals, all normalized to 0..1 where present. */
export type Signals = {
  lexical?: number;
  vector?: number;
  /** Reciprocal-rank-fusion score, normalized against the best possible. */
  rrf?: number;
  /** The candidate's position's fusion score, 1 for the leading position (fusion.ts groupFusion). */
  positionRrf?: number;
  /** The reranker's own 0..1 confidence. Never used alone. */
  llm?: number;
};

export type Ranks = {
  lexical?: number;
  vector?: number;
  fusion?: number;
};

export type ScoredCandidate = {
  candidate: MxikCandidate;
  signals: Signals;
  ranks: Ranks;
  /** Calibrated 0..1. See docs/scoring.md for the formula. */
  confidence: number;
  band: ConfidenceBand;
  /** One sentence the UI can show verbatim. */
  reason: string;
  stage: MatchStage;
  /** Rule adjustments applied, for auditability. */
  adjustments: string[];
  /** Checkable facts behind the suggestion, shown as "Nega bu kod?". */
  evidence: MatchEvidence;
};

export type MatchInput = {
  rawName: string;
  barcode?: string | null;
  unit?: string | null;
  existingMxik?: string | null;
  /** The row's TIF TN (TN VED / HS) code; its heading restricts retrieval (tnved.ts). */
  tnved?: string | null;
};

/**
 * What the row's TN VED code did: none on the row, unreadable (ignored),
 * restricted retrieval to its heading, or restricted it to nothing so retrieval
 * ran over the whole classifier ("fallback"). "unscoped": the store cannot
 * restrict, so the heading was only recorded.
 */
export type TnvedOutcome = 'none' | 'invalid' | 'restricted' | 'fallback' | 'unscoped';

/**
 * What stage 6 did for a row: not needed (settled before retrieval), off for
 * this run, skipped by the gate, failed or gave nothing usable, ranked, or
 * vetoed every candidate ("none").
 */
export type RerankOutcome = 'not_needed' | 'off' | 'skipped' | 'failed' | 'ranked' | 'none';

/** What stage 4 did for a row: not needed, switched off, failed, or used. */
export type VectorOutcome = 'not_needed' | 'off' | 'failed' | 'used';

/** The reranker judged that none of the offered codes fits the row. */
export type RerankVeto = { offered: string[] };

export type MatchResult = {
  input: MatchInput;
  normalized: NormalizedName;
  /** Best five, most confident first. */
  candidates: ScoredCandidate[];
  /** The stage that settled the answer. */
  decidedBy: MatchStage;
  /** Anything the operator should know: degraded providers, rule firings. */
  notes: string[];
  rerank: RerankOutcome;
  vector: VectorOutcome;
  /** Set when stage 6 judged that no candidate fits; `candidates` then keep retrieval order, capped. */
  veto: RerankVeto | null;
  /** What the row's TN VED code did; absent on results built before the column existed. */
  tnved?: TnvedOutcome;
  /**
   * Codes in the fused pool handed to the reranker, best-first. Wider than
   * `candidates`, which is truncated to topK. Exposed so the eval can measure
   * the ceiling stage 6 could reach: a code absent here is unreachable however
   * good the reranker is.
   */
  pool: string[];
};

/** Retrieval backend, so the pipeline can be tested against a fake. */
export type CandidateStore = {
  byBarcode(barcode: string): Promise<MxikCandidate[]>;
  byMatchKey(keys: readonly string[]): Promise<MxikCandidate[]>;
  byLexical(query: string, limit: number): Promise<{ candidate: MxikCandidate; score: number }[]>;
  /**
   * `hierarchyWords`: query words found only in the code's position, class or group names (weighted column).
   * `anchored`: only the query's rarest words select (in at most 50 codes, else under 1,000: store.ts), every word
   * still ranks; no rare word = no hits. A store that cannot count terms ignores it.
   */
  byFullText(query: string, limit: number, opts?: { anchored?: boolean }): Promise<{ candidate: MxikCandidate; score: number; hierarchyWords?: string[] }[]>;
  /** `column`: 'uz' (embeddingUz) or 'ru' (embeddingRu); the store's default when absent. `cosine`: raw similarity. */
  byVector(embedding: readonly number[], limit: number, column?: 'uz' | 'ru'): Promise<{ candidate: MxikCandidate; score: number; cosine?: number }[]>;
  /**
   * Raw cosine of `embedding` against each of `codes` that has a vector in `column`,
   * for codes another stage retrieved. Absent = the store cannot look vectors up by code.
   */
  cosinesFor?(embedding: readonly number[], codes: readonly string[], column?: 'uz' | 'ru'): Promise<Map<string, number>>;
  /** byLexical's trigram score of `query` for each of `codes`, without the similarity threshold. Absent = cannot score by code. */
  lexicalFor?(query: string, codes: readonly string[]): Promise<Map<string, number>>;
  byCode(code: string): Promise<MxikCandidate | null>;
  baseCodeFor(subPositionCode: string): Promise<MxikCandidate | null>;
  /** The subset of `codes` that exist in the classifier and are not retired. */
  liveCodes(codes: readonly string[]): Promise<Set<string>>;
  /**
   * The same store with exact, lexical, full-text and vector retrieval limited
   * to codes starting with `prefix` (a TN VED heading, tnved.ts). Absent = the
   * store cannot restrict, and the pipeline only records the heading.
   */
  withinPrefix?(prefix: string): CandidateStore;
};

export type EmbeddingProvider = {
  readonly name: string;
  readonly dimensions: number;
  /** True for real semantic models; false for the local development stand-in. */
  readonly semantic: boolean;
  /**
   * The text shape its vectors are made from (src/core/embed/text.ts); absent
   * means 'folded', the shape every provider used before 2026-10-22.
   */
  readonly textShape?: TextShape;
  /** `role` picks the model's query or passage form where it has one (e5); others ignore it. */
  embed(texts: readonly string[], role?: EmbedRole): Promise<number[][]>;
};

/** Everything a reranker may see about a catalogue row. Nothing else is sent. */
export type RerankRequest = {
  /** Cleaned product name as shown to the user. Sent. */
  productName: string;
  /** Folded match key, used only as a cache key. Never sent. */
  normalizedKey: string;
  /** The row's unit as written. Sent. */
  unit: string | null;
  /** Public classifier rows: code, name, path, binding. Sent. */
  candidates: MxikCandidate[];
};

export type RerankVerdict = {
  code: string;
  confidence: number;
  reason: string;
};

/** Per-run LLM accounting, for the audit log and the eval report. */
export type RerankUsage = {
  model: string;
  /** Rows the gate passed to the reranker. */
  rowsRequested: number;
  /** Rows actually sent to the API (cache misses). */
  rowsSent: number;
  cacheHits: number;
  /** Rows that fell back to the non-LLM ranking. */
  rowsFailed: number;
  /** Returned codes dropped for not being among the row's candidates. */
  codesDiscarded: number;
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** Median time of one answered API call; null before any call. */
  batchLatencyP50Ms?: number | null;
  /** USD, null when the model's price is unknown. */
  estimatedCostUsd: number | null;
};

export type RerankProvider = {
  readonly name: string;
  readonly available: boolean;
  rerank(request: RerankRequest): Promise<RerankVerdict[]>;
  /** Accounting since construction; absent on providers that never call out. */
  usage?(): RerankUsage;
};
