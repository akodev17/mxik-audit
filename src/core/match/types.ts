import type { NormalizedName } from '../normalize/index.js';

/** Which pipeline stage produced or last touched a candidate. */
export type MatchStage = 'barcode' | 'exact' | 'lexical' | 'vector' | 'fusion' | 'rerank' | 'none';

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
};

export type MatchInput = {
  rawName: string;
  barcode?: string | null;
  unit?: string | null;
  existingMxik?: string | null;
};

export type MatchResult = {
  input: MatchInput;
  normalized: NormalizedName;
  /** Best five, most confident first. */
  candidates: ScoredCandidate[];
  /** The stage that settled the answer. */
  decidedBy: MatchStage;
  /** Anything the operator should know: degraded providers, rule firings. */
  notes: string[];
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
  byFullText(query: string, limit: number): Promise<{ candidate: MxikCandidate; score: number }[]>;
  byVector(embedding: readonly number[], limit: number): Promise<{ candidate: MxikCandidate; score: number }[]>;
  byCode(code: string): Promise<MxikCandidate | null>;
  baseCodeFor(subPositionCode: string): Promise<MxikCandidate | null>;
};

export type EmbeddingProvider = {
  readonly name: string;
  readonly dimensions: number;
  /** True for real semantic models; false for the local development stand-in. */
  readonly semantic: boolean;
  embed(texts: readonly string[]): Promise<number[][]>;
};

export type RerankRequest = {
  productName: string;
  attrs: Record<string, unknown>;
  candidates: MxikCandidate[];
};

export type RerankVerdict = {
  code: string;
  confidence: number;
  reason: string;
};

export type RerankProvider = {
  readonly name: string;
  readonly available: boolean;
  rerank(request: RerankRequest): Promise<RerankVerdict[]>;
};
