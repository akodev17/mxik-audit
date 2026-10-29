// Postgres-backed retrieval. The only I/O in the matching path; everything else
// in src/core/match is pure so it can be tested without a database.
import type { Pool } from 'pg';
import type { CandidateStore, MxikCandidate } from './types.js';
import type { VectorColumn } from './vector-readiness.js';

export const SELECT_FIELDS = `
  code, "nameUz", "nameRu",
  "groupNameUz" AS "groupName", "classNameUz" AS "className",
  "positionNameUz" AS "positionName", "subPositionNameUz" AS "subPositionName",
  "brandNameUz" AS "brandName", "attributeNameUz" AS "attributeName",
  "subPositionCode", "isBase", "isMarked", "unitBinding", "unitCanonical", "recommendedUnits",
  "unitRaw", "unitContainer", barcode
`;

export type Row = {
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
  isMarked: boolean | null;
  unitBinding: 'strict' | 'recommended' | 'none';
  unitCanonical: string[];
  recommendedUnits: string[] | null;
  unitRaw: string | null;
  unitContainer: string | null;
  barcode: string | null;
};

export function toCandidate(row: Row): MxikCandidate {
  return {
    code: row.code.trim(),
    nameUz: row.nameUz,
    nameRu: row.nameRu,
    groupName: row.groupName,
    className: row.className,
    positionName: row.positionName,
    subPositionName: row.subPositionName,
    brandName: row.brandName,
    attributeName: row.attributeName,
    subPositionCode: row.subPositionCode.trim(),
    isBase: row.isBase,
    isMarked: row.isMarked,
    unitBinding: row.unitBinding,
    unitCanonical: row.unitCanonical ?? [],
    recommendedUnits: row.recommendedUnits ?? [],
    unitRaw: row.unitRaw,
    unitContainer: row.unitContainer,
    barcode: row.barcode?.trim() ?? null,
  };
}

/** Failures where the query never reached Postgres or its answer was lost. */
const TRANSIENT_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', '57P01', '08000', '08003', '08006']);

export function isTransient(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && TRANSIENT_CODES.has(code);
}

let transientRetries = 0;
/** How many reads were retried after a transient failure, process-wide. */
export function storeRetryCount(): number {
  return transientRetries;
}

/** pgvector literal: '[1,2,3]'. */
function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

export type StoreOptions = {
  embeddingColumn?: 'embeddingUz' | 'embeddingRu';
  /**
   * Bypass the HNSW index and scan exactly.
   *
   * Needed for the local placeholder embedder, whose vectors are very sparse:
   * distances cluster on a plateau around 0.80 while true neighbours sit at
   * ~0.04, so HNSW's greedy descent cannot reach them and misses even an exact
   * self-match — at any ef_search. Real dense embeddings do not have this
   * problem, so leave this off in production. Costs ~1.7s per query over 439k rows.
   */
  exactVectorScan?: boolean;
  /** HNSW search breadth when the index is in use; DEFAULT_EF_SEARCH (1000) when absent. */
  efSearch?: number;
  /**
   * Set false to skip vector retrieval entirely — used when the stored vectors
   * were produced by a different model than the one embedding queries.
   */
  vectorEnabled?: boolean;
  /**
   * Full-text terms found in more live classifier rows than this still count in
   * the ranking but no longer select candidates: "uchun" alone matches 117k rows,
   * and ranking all of them cost ~0.4s per query. 0 = every term selects.
   */
  fullTextCommonDocs?: number;
  /**
   * Which full-text column to use. 'plain' (default) is the leaf-name
   * "searchVector". 'weighted' ranks on the hierarchy-aware
   * "searchVectorWeighted" once its index exists (the fill scripts build it
   * only after every row has a vector) and falls back to plain until then.
   * Opt-in: on the 2026-10-21 eval it changed no case (runs 23-25, plan §3.1).
   */
  fullTextColumn?: 'plain' | 'weighted';
  /**
   * Weights whose words may select a candidate from the weighted column; the
   * other weights only add to the rank. 'A' (default) selects on the code's own
   * names, exactly like the plain column, and lets the hierarchy reorder them.
   */
  fullTextSelectWeights?: 'A' | 'AB';
  /**
   * Trigram retrieval first runs at this stricter word_similarity threshold and
   * falls back to the server's default (0.6) only when that does not fill the
   * limit; the result is identical either way (byLexical). null = one query at
   * the default, as before 2026-10-21.
   */
  lexicalStrictThreshold?: number | null;
  /**
   * Limits exact, lexical, full-text and vector retrieval to codes starting
   * with these digits: a TN VED heading ("07306", tnved.ts). Lookups of a known
   * code (barcode, byCode, baseCodeFor, liveCodes) are never limited.
   * Set through withinPrefix().
   */
  codePrefix?: string;
};

/**
 * Headings up to this many live codes are scored exhaustively (every code gets
 * a trigram score and an exact cosine): 618 codes cost 23 ms, while the index
 * paths miss codes in a small slice of the table. 92% of headings are smaller
 * (p90 437 codes, 2026-10-23, docs/scoring.md appendix C).
 */
export const SCOPED_SCAN_MAX = 1000;

/**
 * HNSW search breadth. With e5 and the m=32, ef_construction=200 index
 * (scripts/lib/hnsw.ts), 1000 gives mean recall@50 0.95 against an exact scan
 * on the metal eval rows at 13 ms per query; 100 gave 0.65 (2026-10-22,
 * `npm run eval:recall`).
 */
export const DEFAULT_EF_SEARCH = 1000;

/** See StoreOptions.lexicalStrictThreshold; chosen with `npm run perf` (docs/perf-results.json). */
export const DEFAULT_LEXICAL_STRICT_THRESHOLD = 0.75;

/** LEXICAL_STRICT_THRESHOLD: a number in (0, 1], or "off" for the single default query; unset = the default. */
export function lexicalStrictThresholdFromEnv(env: Record<string, string | undefined>): number | null | undefined {
  const raw = env['LEXICAL_STRICT_THRESHOLD']?.trim();
  if (!raw) return undefined;
  if (raw === 'off') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : undefined;
}

/** See StoreOptions.fullTextCommonDocs; chosen by eval (docs/eval-results.json). */
export const DEFAULT_FULLTEXT_COMMON_DOCS = 10_000;

/**
 * ts_rank_cd weights for D, C, B, A (Postgres' order). A stays 0.1, the weight
 * every lexeme of the plain column has, so a leaf-only hit ranks exactly as
 * before and score.ts' FULLTEXT_K keeps its meaning; each level up the
 * hierarchy counts half as much as the one below it.
 */
export const FULLTEXT_RANK_WEIGHTS = [0.0125, 0.025, 0.05, 0.1] as const;

/** GIN index on "searchVectorWeighted"; built last by the fill scripts, so its validity means "filled". */
export const WEIGHTED_INDEX = 'mxik_code_search_vector_weighted_idx';
/** Floor for the cached term counts (~11k terms); any useful cutoff sits above it. */
const TERM_STATS_FLOOR = 50;
/**
 * Anchored full-text (byFullText): the words in at most ANCHOR_DOCS codes
 * select ("ЭНАМ" is in 8, "суппозитории" in hundreds), else those in fewer than
 * ANCHOR_MAX_DOCS ("метронидазол", 301). Cut at the stats floor, which counts nothing below it.
 */
const ANCHOR_DOCS = TERM_STATS_FLOOR;
const ANCHOR_MAX_DOCS = 1000;
/** Per pool and column: how many live rows contain each frequent full-text term. */
const termStats = new WeakMap<Pool, Map<string, Promise<Map<string, number>>>>();
/** Per pool: whether the weighted column is filled and indexed. */
const weightedReady = new WeakMap<Pool, Promise<boolean>>();
/** Per pool and code prefix: how many live codes the prefix covers. */
const prefixSizes = new WeakMap<Pool, Map<string, Promise<number>>>();

/** Live codes under a prefix, cached per process: it only picks the query strategy, so a stale count is harmless. */
function loadPrefixSize(pool: Pool, prefix: string): Promise<number> {
  const perPool = prefixSizes.get(pool) ?? new Map<string, Promise<number>>();
  prefixSizes.set(pool, perPool);
  const cached = perPool.get(prefix);
  if (cached) return cached;
  const loading = pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM mxik_code WHERE code LIKE $1 AND "retiredAt" IS NULL`, [`${prefix}%`],
  ).then((res) => Number(res.rows[0]?.n ?? 0))
    .catch((error: unknown) => {
      perPool.delete(prefix);
      throw error;
    });
  perPool.set(prefix, loading);
  return loading;
}

/**
 * Counts per term, over the words that select: the plain column, or the
 * weighted column restricted to the selecting weights (ts_stat's second argument).
 */
function loadTermStats(pool: Pool, column: 'searchVector' | 'searchVectorWeighted', weights: string): Promise<Map<string, number>> {
  const key = `${column}:${weights}`;
  const perPool = termStats.get(pool) ?? new Map<string, Promise<Map<string, number>>>();
  termStats.set(pool, perPool);
  const cached = perPool.get(key);
  if (cached) return cached;
  const source = `SELECT "${column}" FROM mxik_code WHERE "retiredAt" IS NULL`;
  // ~5s once per process; a failure is not cached, and filters on every term meanwhile.
  const loading = pool.query<{ word: string; ndoc: number }>(
    column === 'searchVector'
      ? `SELECT word, ndoc FROM ts_stat($2) WHERE ndoc > $1`
      : `SELECT word, ndoc FROM ts_stat($2, $3) WHERE ndoc > $1`,
    column === 'searchVector' ? [TERM_STATS_FLOOR, source] : [TERM_STATS_FLOOR, source, weights],
  ).then((res) => new Map(res.rows.map((r) => [r.word, Number(r.ndoc)])))
    .catch(() => {
      perPool.delete(key);
      return new Map<string, number>();
    });
  perPool.set(key, loading);
  return loading;
}

/** The weighted column is used only once its index is built and valid: the fill scripts build it last. */
function loadWeightedReady(pool: Pool): Promise<boolean> {
  const cached = weightedReady.get(pool);
  if (cached) return cached;
  const loading = pool.query<{ valid: boolean }>(
    `SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1`,
    [WEIGHTED_INDEX],
  ).then((res) => res.rows[0]?.valid === true)
    .catch(() => {
      weightedReady.delete(pool);
      return false;
    });
  weightedReady.set(pool, loading);
  return loading;
}

/** A vector hit; `cosine` is the raw cosine similarity behind `score`. */
export type VectorHit = { candidate: MxikCandidate; score: number; cosine?: number };

/** A full-text hit; `hierarchyWords` are query words found only above the code's own names. */
export type FullTextHit = { candidate: MxikCandidate; score: number; hierarchyWords?: string[] };

export class PostgresCandidateStore implements CandidateStore {
  private readonly embeddingColumn: 'embeddingUz' | 'embeddingRu';
  private readonly exactVectorScan: boolean;
  private readonly efSearch: number;
  private readonly vectorEnabled: boolean;
  private readonly fullTextCommonDocs: number;
  private readonly fullTextColumn: 'plain' | 'weighted';
  private readonly fullTextSelectWeights: 'A' | 'AB';
  private readonly lexicalStrictThreshold: number | null;
  /** LIKE pattern of the code prefix retrieval is limited to; null = the whole classifier. */
  private readonly prefixPattern: string | null;

  constructor(private readonly pool: Pool, private readonly options: StoreOptions = {}) {
    // Interpolated nowhere, but a non-digit prefix would be a LIKE pattern, so only digits are accepted.
    if (options.codePrefix !== undefined && !/^\d{1,16}$/.test(options.codePrefix)) throw new Error(`not a code prefix: ${options.codePrefix}`);
    this.prefixPattern = options.codePrefix === undefined ? null : `${options.codePrefix}%`;
    this.embeddingColumn = options.embeddingColumn ?? 'embeddingUz';
    this.exactVectorScan = options.exactVectorScan ?? false;
    // Interpolated into SET LOCAL, so only a positive integer is accepted.
    this.efSearch = Number.isInteger(options.efSearch) && (options.efSearch ?? 0) > 0 ? (options.efSearch ?? DEFAULT_EF_SEARCH) : DEFAULT_EF_SEARCH;
    this.vectorEnabled = options.vectorEnabled ?? true;
    this.fullTextCommonDocs = options.fullTextCommonDocs ?? DEFAULT_FULLTEXT_COMMON_DOCS;
    this.fullTextColumn = options.fullTextColumn ?? 'plain';
    this.fullTextSelectWeights = options.fullTextSelectWeights ?? 'A';
    const strict = options.lexicalStrictThreshold === undefined ? DEFAULT_LEXICAL_STRICT_THRESHOLD : options.lexicalStrictThreshold;
    // Interpolated into SET LOCAL, so only a plain number in (0, 1] is accepted.
    this.lexicalStrictThreshold = strict !== null && Number.isFinite(strict) && strict > 0 && strict <= 1 ? strict : null;
  }

  /** This store with retrieval limited to codes starting with `prefix` (StoreOptions.codePrefix). */
  withinPrefix(prefix: string): PostgresCandidateStore {
    return new PostgresCandidateStore(this.pool, { ...this.options, codePrefix: prefix });
  }

  /** How retrieval is limited: not at all, to a small prefix scored exhaustively, or to a large one through the indexes. */
  private async scope(): Promise<'all' | 'scan' | 'indexed'> {
    if (this.options.codePrefix === undefined) return 'all';
    return (await loadPrefixSize(this.pool, this.options.codePrefix)) <= SCOPED_SCAN_MAX ? 'scan' : 'indexed';
  }

  /** `AND code LIKE $n` with the prefix as parameter n, or nothing for an unlimited store. */
  private prefixClause(n: number): { sql: string; params: string[] } {
    return this.prefixPattern === null ? { sql: '', params: [] } : { sql: ` AND code LIKE $${n}`, params: [this.prefixPattern] };
  }

  /** The full-text column this store ranks on, after checking that the weighted one is ready. */
  async fullTextSource(): Promise<'searchVector' | 'searchVectorWeighted'> {
    if (this.fullTextColumn === 'plain') return 'searchVector';
    return (await loadWeightedReady(this.pool)) ? 'searchVectorWeighted' : 'searchVector';
  }

  async byBarcode(barcode: string): Promise<MxikCandidate[]> {
    const res = await this.read(() => this.pool.query<Row>(
      `SELECT ${SELECT_FIELDS} FROM mxik_code WHERE barcode = $1 AND "retiredAt" IS NULL LIMIT 10`,
      [barcode],
    ));
    return res.rows.map(toCandidate);
  }

  async byMatchKey(keys: readonly string[]): Promise<MxikCandidate[]> {
    if (keys.length === 0) return [];
    const prefix = this.prefixClause(2);
    const res = await this.read(() => this.pool.query<Row>(
      `SELECT ${SELECT_FIELDS} FROM mxik_code
       WHERE "matchKeys" && $1::text[] AND "retiredAt" IS NULL${prefix.sql}
       -- Base codes first: the sanctioned answer when several rows tie.
       ORDER BY "isBase" DESC, code LIMIT 20`,
      [keys, ...prefix.params],
    ));
    return res.rows.map(toCandidate);
  }

  async byLexical(query: string, limit: number): Promise<{ candidate: MxikCandidate; score: number }[]> {
    if (!query) return [];
    const scope = await this.scope();
    const prefix = this.prefixClause(3);
    if (scope === 'scan') {
      // A small heading: every code with any trigram in common scores, so a
      // vague name ("Труба 57") still ranks the heading's codes. The prefix
      // index finds them; no threshold is needed to bound the cost.
      const res = await this.read(() => this.pool.query<Row & { score: number }>(
        `SELECT * FROM (
           SELECT ${SELECT_FIELDS}, word_similarity($1, "searchText") AS score
           FROM mxik_code WHERE "retiredAt" IS NULL${prefix.sql}
         ) s WHERE score > 0
         ORDER BY score DESC, "isBase" DESC, code
         LIMIT $2`,
        [query, limit, ...prefix.params],
      ));
      return res.rows.map((r) => ({ candidate: toCandidate(r), score: Number(r.score) }));
    }
    // word_similarity, not similarity: the target is a whole product name and
    // plain similarity dilutes a short query below the threshold entirely.
    const sql = `SELECT ${SELECT_FIELDS}, word_similarity($1, "searchText") AS score
       FROM mxik_code
       WHERE $1 <% "searchText" AND "retiredAt" IS NULL${prefix.sql}
       ORDER BY score DESC, "isBase" DESC, code
       LIMIT $2`;
    const params = [query, limit, ...prefix.params];
    if (this.lexicalStrictThreshold === null) {
      const res = await this.read(() => this.pool.query<Row & { score: number }>(sql, params));
      return res.rows.map((r) => ({ candidate: toCandidate(r), score: Number(r.score) }));
    }
    // A strict pass first. The GIN index prunes by the threshold, and the cost
    // is rechecking every pruned-in row of a wide table: "truba ..." pulled
    // 9,836 rows at the default 0.6 (660 ms) and 619 at 0.75 (80 ms). When the
    // strict pass fills the limit, no row below it could have ranked, so the
    // answer is the default query's exactly; otherwise run that query.
    const strict = this.lexicalStrictThreshold;
    return this.read(async () => {
      const client = await this.pool.connect();
      let failure: Error | undefined;
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL pg_trgm.word_similarity_threshold = ${strict}`);
        let res = await client.query<Row & { score: number }>(sql, params);
        if (res.rows.length < limit) {
          await client.query('SET LOCAL pg_trgm.word_similarity_threshold TO DEFAULT');
          res = await client.query<Row & { score: number }>(sql, params);
        }
        await client.query('COMMIT');
        return res.rows.map((r) => ({ candidate: toCandidate(r), score: Number(r.score) }));
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        // A connection that failed is destroyed, never handed back to the pool.
        client.release(failure);
      }
    });
  }

  /**
   * Full-text retrieval, the second half of stage 3. Complements trigram:
   * trigram rewards character overlap and so favours long near-identical names,
   * while FTS rewards covering the query's tokens regardless of their position.
   * The 'simple' config is used because Postgres ships no Uzbek dictionary.
   *
   * On the weighted column, words in the code's own names (weight A) select
   * candidates as before, while words of the position, class and group names
   * add to the rank at a lower weight: "лист горячекатаный" lifts the codes
   * whose position says "горячекатаный" (plan §3.1). The words that hit only
   * the hierarchy come back for the evidence.
   */
  async byFullText(query: string, limit: number, opts: { anchored?: boolean } = {}): Promise<FullTextHit[]> {
    // A trade mark separates words as Postgres reads the classifier: "КАРЛОН®ПЛЮС" is indexed as karlon, plyus.
    const terms = query.split(/[\s®™©]+/).filter(Boolean);
    if (terms.length === 0) return [];
    // OR the terms so a partial cover still retrieves; ranking sorts it out.
    const words = terms.map((t) => t.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()).filter(Boolean);
    if (words.length === 0) return [];
    const column = await this.fullTextSource();
    const weights = column === 'searchVector' ? '' : this.fullTextSelectWeights;
    if (opts.anchored) {
      // Only the rare words (a brand: "ЭНАМ" is in 8 codes, "таблетки" in 14k)
      // select, so a code sharing just that word is found however many codes
      // repeat the name's common words more often. Numbers never anchor.
      const stats = await loadTermStats(this.pool, column, weights);
      const named = words.filter((w) => !/^\d+$/.test(w));
      for (const cutoff of [ANCHOR_DOCS, ANCHOR_MAX_DOCS - 1]) {
        const anchors = named.filter((w) => (stats.get(w) ?? 0) <= cutoff);
        // The rarest words may be no word of the classifier at all (a typo, a spelling variant): then the next tier.
        const hits = anchors.length === 0 ? [] : await this.fullTextQuery(words, anchors, limit, column);
        if (hits.length > 0) return hits;
      }
      return [];
    }
    const selecting = await this.selectingTerms(words, column, weights);
    const hits = await this.fullTextQuery(words, selecting, limit, column);
    // Within a heading the classifier-wide rare words may not occur at all
    // ("57" among the 7304 pipes); then the common ones ("truba") select, which
    // the prefix keeps cheap. Not first: a common word repeated in a code's
    // name outranks the rare word that identifies it ("kabel" vs "avvg").
    if (this.prefixPattern === null || hits.length > 0 || selecting.length === words.length) return hits;
    return this.fullTextQuery(words, words, limit, column);
  }

  /** One full-text query: ranks on every word, selects on `selecting`. */
  private async fullTextQuery(
    words: readonly string[], selecting: readonly string[], limit: number, column: 'searchVector' | 'searchVectorWeighted',
  ): Promise<FullTextHit[]> {
    if (column === 'searchVector') {
      const prefix = this.prefixClause(4);
      const res = await this.read(() => this.pool.query<Row & { score: number }>(
        `SELECT ${SELECT_FIELDS}, ts_rank_cd("searchVector", q) AS score
         FROM mxik_code, to_tsquery('simple', $1) AS q, to_tsquery('simple', $3) AS f
         WHERE "searchVector" @@ f AND "retiredAt" IS NULL${prefix.sql}
         ORDER BY score DESC, "isBase" DESC, code
         LIMIT $2`,
        [words.join(' | '), limit, selecting.join(' | '), ...prefix.params],
      ));
      return res.rows.map((r) => ({ candidate: toCandidate(r), score: Number(r.score) }));
    }
    const weights = this.fullTextSelectWeights;
    const prefix = this.prefixClause(6);
    const res = await this.read(() => this.pool.query<Row & { score: number; hierarchyWords: string[] | null }>(
      `SELECT ${SELECT_FIELDS}, ts_rank_cd($4::float4[], "searchVectorWeighted", q) AS score,
         ARRAY(SELECT u.lexeme FROM unnest("searchVectorWeighted") AS u
               WHERE u.lexeme = ANY($5::text[]) AND NOT ('A' = ANY(u.weights))) AS "hierarchyWords"
       FROM mxik_code, to_tsquery('simple', $1) AS q, to_tsquery('simple', $3) AS f
       WHERE "searchVectorWeighted" @@ f AND "retiredAt" IS NULL${prefix.sql}
       ORDER BY score DESC, "isBase" DESC, code
       LIMIT $2`,
      [words.join(' | '), limit, selecting.map((w) => `${w}:${weights}`).join(' | '), [...FULLTEXT_RANK_WEIGHTS], words, ...prefix.params],
    ));
    return res.rows.map((r) => {
      const hierarchyWords = r.hierarchyWords ?? [];
      return { candidate: toCandidate(r), score: Number(r.score), ...(hierarchyWords.length > 0 ? { hierarchyWords } : {}) };
    });
  }

  /**
   * Nearest codes by cosine. `column` picks the vector column (uz = "embeddingUz",
   * ru = "embeddingRu"), the store's default when absent. `score` is the cosine
   * mapped onto 0..1 as (1 + cos) / 2; `cosine` is the raw value, which semantic
   * providers calibrate to their own range (score.ts vectorToUnit).
   */
  async byVector(embedding: readonly number[], limit: number, column?: VectorColumn): Promise<VectorHit[]> {
    if (!this.vectorEnabled || embedding.length === 0) return [];
    const col = `"${column === undefined ? this.embeddingColumn : column === 'ru' ? 'embeddingRu' : 'embeddingUz'}"`;
    const scope = await this.scope();
    const prefix = this.prefixClause(3);
    // Within a heading the HNSW index alone returns the global neighbours and
    // drops the ones outside: 1 code of 50 for a 15k-code heading. A small
    // heading is scanned exactly (the materialized CTE keeps the planner off the
    // index); a large one uses the index with pgvector's iterative scan, which
    // keeps walking the graph until the limit is filled (recall@50 0.98-1.0
    // against exact on the four largest headings, 14-70 ms, 2026-10-23).
    const exact = scope === 'scan' || (scope === 'indexed' && this.exactVectorScan);
    const sql = exact
      ? `WITH s AS MATERIALIZED (
           SELECT ${SELECT_FIELDS}, (${col} <=> $1::vector) AS distance
           FROM mxik_code WHERE ${col} IS NOT NULL AND "retiredAt" IS NULL${prefix.sql}
         ) SELECT * FROM s ORDER BY distance, code LIMIT $2`
      : `SELECT ${SELECT_FIELDS}, (${col} <=> $1::vector) AS distance
           FROM mxik_code
           WHERE ${col} IS NOT NULL AND "retiredAt" IS NULL${prefix.sql}
           ORDER BY ${col} <=> $1::vector
           LIMIT $2`;
    // The planner setting has to apply to the same session as the query, so
    // take a dedicated connection rather than going through pool.query.
    return this.read(async () => {
      const client = await this.pool.connect();
      let failure: Error | undefined;
      try {
        await client.query('BEGIN');
        if (this.exactVectorScan && scope === 'all') {
          await client.query('SET LOCAL enable_indexscan = off');
        } else if (!exact) {
          await client.query(`SET LOCAL hnsw.ef_search = ${this.efSearch}`);
          if (scope === 'indexed') await client.query('SET LOCAL hnsw.iterative_scan = relaxed_order');
        }
        // <=> is cosine distance in 0..2; convert to a 0..1 similarity.
        const res = await client.query<Row & { distance: number }>(sql, [toVectorLiteral(embedding), limit, ...prefix.params]);
        await client.query('COMMIT');
        // relaxed_order may return neighbours slightly out of order.
        const rows = scope === 'indexed' ? [...res.rows].sort((a, b) => Number(a.distance) - Number(b.distance)) : res.rows;
        return rows.map((r) => ({
          candidate: toCandidate(r),
          score: Math.max(0, Math.min(1, 1 - Number(r.distance) / 2)),
          cosine: 1 - Number(r.distance),
        }));
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        // A connection that failed is destroyed, never handed back to the pool.
        client.release(failure);
      }
    });
  }

  /** The query's terms rare enough to select candidates; all of them when none are. */
  private async selectingTerms(
    words: readonly string[], column: 'searchVector' | 'searchVectorWeighted', weights: string,
  ): Promise<readonly string[]> {
    if (this.fullTextCommonDocs <= 0) return words;
    const stats = await loadTermStats(this.pool, column, weights);
    const rare = words.filter((w) => (stats.get(w.toLowerCase()) ?? 0) <= this.fullTextCommonDocs);
    return rare.length > 0 ? rare : words;
  }

  /**
   * Every query here is a read, so one that died on the wire (connection
   * reset, server restart) is simply run again, once.
   */
  private async read<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!isTransient(error)) throw error;
      transientRetries++;
      return run();
    }
  }

  async byCode(code: string): Promise<MxikCandidate | null> {
    const res = await this.read(() => this.pool.query<Row>(
      `SELECT ${SELECT_FIELDS} FROM mxik_code WHERE code = $1`,
      [code],
    ));
    const row = res.rows[0];
    return row ? toCandidate(row) : null;
  }

  async baseCodeFor(subPositionCode: string): Promise<MxikCandidate | null> {
    const res = await this.read(() => this.pool.query<Row>(
      `SELECT ${SELECT_FIELDS} FROM mxik_code
       WHERE "subPositionCode" = $1 AND "isBase" AND "retiredAt" IS NULL LIMIT 1`,
      [subPositionCode],
    ));
    const row = res.rows[0];
    return row ? toCandidate(row) : null;
  }

  async liveCodes(codes: readonly string[]): Promise<Set<string>> {
    if (codes.length === 0) return new Set();
    const res = await this.read(() => this.pool.query<{ code: string }>(
      'SELECT code FROM mxik_code WHERE code = ANY($1::char(17)[]) AND "retiredAt" IS NULL',
      [codes],
    ));
    return new Set(res.rows.map((r) => r.code.trim()));
  }

  /** True when the code exists at all, regardless of retirement. */
  async exists(code: string): Promise<{ found: boolean; retired: boolean }> {
    const res = await this.read(() => this.pool.query<{ retiredAt: Date | null }>(
      'SELECT "retiredAt" FROM mxik_code WHERE code = $1',
      [code],
    ));
    const row = res.rows[0];
    if (!row) return { found: false, retired: false };
    return { found: true, retired: row.retiredAt !== null };
  }
}
