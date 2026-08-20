// Postgres-backed retrieval. The only I/O in the matching path; everything else
// in src/core/match is pure so it can be tested without a database.
import type { Pool } from 'pg';
import type { CandidateStore, MxikCandidate } from './types.js';

const SELECT_FIELDS = `
  code, "nameUz", "nameRu",
  "groupNameUz" AS "groupName", "classNameUz" AS "className",
  "positionNameUz" AS "positionName", "subPositionNameUz" AS "subPositionName",
  "brandNameUz" AS "brandName", "attributeNameUz" AS "attributeName",
  "subPositionCode", "isBase", "isMarked", "unitBinding", "unitCanonical",
  "unitRaw", "unitContainer", barcode
`;

type Row = {
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
  unitRaw: string | null;
  unitContainer: string | null;
  barcode: string | null;
};

function toCandidate(row: Row): MxikCandidate {
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
    unitRaw: row.unitRaw,
    unitContainer: row.unitContainer,
    barcode: row.barcode?.trim() ?? null,
  };
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
  /** HNSW search breadth when the index is in use. */
  efSearch?: number;
  /**
   * Set false to skip vector retrieval entirely — used when the stored vectors
   * were produced by a different model than the one embedding queries.
   */
  vectorEnabled?: boolean;
};

export class PostgresCandidateStore implements CandidateStore {
  private readonly embeddingColumn: 'embeddingUz' | 'embeddingRu';
  private readonly exactVectorScan: boolean;
  private readonly efSearch: number;
  private readonly vectorEnabled: boolean;

  constructor(private readonly pool: Pool, options: StoreOptions = {}) {
    this.embeddingColumn = options.embeddingColumn ?? 'embeddingUz';
    this.exactVectorScan = options.exactVectorScan ?? false;
    this.efSearch = options.efSearch ?? 100;
    this.vectorEnabled = options.vectorEnabled ?? true;
  }

  async byBarcode(barcode: string): Promise<MxikCandidate[]> {
    const res = await this.pool.query<Row>(
      `SELECT ${SELECT_FIELDS} FROM mxik_code WHERE barcode = $1 AND "retiredAt" IS NULL LIMIT 10`,
      [barcode],
    );
    return res.rows.map(toCandidate);
  }

  async byMatchKey(keys: readonly string[]): Promise<MxikCandidate[]> {
    if (keys.length === 0) return [];
    const res = await this.pool.query<Row>(
      `SELECT ${SELECT_FIELDS} FROM mxik_code
       WHERE "matchKeys" && $1::text[] AND "retiredAt" IS NULL
       -- Base codes first: the sanctioned answer when several rows tie.
       ORDER BY "isBase" DESC, code LIMIT 20`,
      [keys],
    );
    return res.rows.map(toCandidate);
  }

  async byLexical(query: string, limit: number): Promise<{ candidate: MxikCandidate; score: number }[]> {
    if (!query) return [];
    // word_similarity, not similarity: the target is a whole product name and
    // plain similarity dilutes a short query below the threshold entirely.
    const res = await this.pool.query<Row & { score: number }>(
      `SELECT ${SELECT_FIELDS}, word_similarity($1, "searchText") AS score
       FROM mxik_code
       WHERE $1 <% "searchText" AND "retiredAt" IS NULL
       ORDER BY score DESC, "isBase" DESC, code
       LIMIT $2`,
      [query, limit],
    );
    return res.rows.map((r) => ({ candidate: toCandidate(r), score: Number(r.score) }));
  }

  /**
   * Full-text retrieval, the second half of stage 3. Complements trigram:
   * trigram rewards character overlap and so favours long near-identical names,
   * while FTS rewards covering the query's tokens regardless of their position.
   * The 'simple' config is used because Postgres ships no Uzbek dictionary.
   */
  async byFullText(query: string, limit: number): Promise<{ candidate: MxikCandidate; score: number }[]> {
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    // OR the terms so a partial cover still retrieves; ranking sorts it out.
    const tsquery = terms.map((t) => t.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).join(' | ');
    if (!tsquery) return [];
    const res = await this.pool.query<Row & { score: number }>(
      `SELECT ${SELECT_FIELDS}, ts_rank_cd("searchVector", q) AS score
       FROM mxik_code, to_tsquery('simple', $1) AS q
       WHERE "searchVector" @@ q AND "retiredAt" IS NULL
       ORDER BY score DESC, "isBase" DESC, code
       LIMIT $2`,
      [tsquery, limit],
    );
    return res.rows.map((r) => ({ candidate: toCandidate(r), score: Number(r.score) }));
  }

  async byVector(embedding: readonly number[], limit: number): Promise<{ candidate: MxikCandidate; score: number }[]> {
    if (!this.vectorEnabled || embedding.length === 0) return [];
    const col = `"${this.embeddingColumn}"`;
    // The planner setting has to apply to the same session as the query, so
    // take a dedicated connection rather than going through pool.query.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (this.exactVectorScan) {
        await client.query('SET LOCAL enable_indexscan = off');
      } else {
        await client.query(`SET LOCAL hnsw.ef_search = ${this.efSearch}`);
      }
      // <=> is cosine distance in 0..2; convert to a 0..1 similarity.
      const res = await client.query<Row & { distance: number }>(
        `SELECT ${SELECT_FIELDS}, (${col} <=> $1::vector) AS distance
         FROM mxik_code
         WHERE ${col} IS NOT NULL AND "retiredAt" IS NULL
         ORDER BY ${col} <=> $1::vector
         LIMIT $2`,
        [toVectorLiteral(embedding), limit],
      );
      await client.query('COMMIT');
      return res.rows.map((r) => ({
        candidate: toCandidate(r),
        score: Math.max(0, Math.min(1, 1 - Number(r.distance) / 2)),
      }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async byCode(code: string): Promise<MxikCandidate | null> {
    const res = await this.pool.query<Row>(
      `SELECT ${SELECT_FIELDS} FROM mxik_code WHERE code = $1`,
      [code],
    );
    const row = res.rows[0];
    return row ? toCandidate(row) : null;
  }

  async baseCodeFor(subPositionCode: string): Promise<MxikCandidate | null> {
    const res = await this.pool.query<Row>(
      `SELECT ${SELECT_FIELDS} FROM mxik_code
       WHERE "subPositionCode" = $1 AND "isBase" AND "retiredAt" IS NULL LIMIT 1`,
      [subPositionCode],
    );
    const row = res.rows[0];
    return row ? toCandidate(row) : null;
  }

  /** True when the code exists at all, regardless of retirement. */
  async exists(code: string): Promise<{ found: boolean; retired: boolean }> {
    const res = await this.pool.query<{ retiredAt: Date | null }>(
      'SELECT "retiredAt" FROM mxik_code WHERE code = $1',
      [code],
    );
    const row = res.rows[0];
    if (!row) return { found: false, retired: false };
    return { found: true, retired: row.retiredAt !== null };
  }
}
