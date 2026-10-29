// Retrieval limited to the detailed codes of one 8-digit position, so the
// normal pipeline can rank replacements for a restricted generalized code
// (RESTRICTED, src/core/audit/checks.ts). Base codes, retired codes and the
// excluded (restricted) codes never come back. No barcode or vector stage:
// the caller switches both off.
import type { Pool } from 'pg';
import { SELECT_FIELDS, toCandidate, type Row } from './store.js';
import type { CandidateStore, MxikCandidate } from './types.js';

export class PositionStore implements CandidateStore {
  private readonly prefix: string;

  constructor(private readonly pool: Pool, position: string, private readonly exclude: readonly string[]) {
    if (!/^\d{8}$/.test(position)) throw new Error(`not an 8-digit position: ${position}`);
    this.prefix = `${position}%`;
  }

  /** The scope every query shares: $1 = prefix, $2 = excluded codes. */
  private static readonly SCOPE = `code LIKE $1 AND NOT "isBase" AND "retiredAt" IS NULL AND NOT (code = ANY($2::char(17)[]))`;

  /** How many detailed codes the position has; 0 means a replacement has to be requested. */
  async size(): Promise<number> {
    const res = await this.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM mxik_code WHERE ${PositionStore.SCOPE}`, [this.prefix, this.exclude],
    );
    return Number(res.rows[0]?.n ?? 0);
  }

  byBarcode(): Promise<MxikCandidate[]> {
    return Promise.resolve([]);
  }

  async byMatchKey(keys: readonly string[]): Promise<MxikCandidate[]> {
    if (keys.length === 0) return [];
    const res = await this.pool.query<Row>(
      `SELECT ${SELECT_FIELDS} FROM mxik_code WHERE ${PositionStore.SCOPE} AND "matchKeys" && $3::text[] ORDER BY code LIMIT 20`,
      [this.prefix, this.exclude, keys],
    );
    return res.rows.map(toCandidate);
  }

  /** Every detailed code of the position scores, without the trigram threshold: the position is small. */
  async byLexical(query: string, limit: number): Promise<{ candidate: MxikCandidate; score: number }[]> {
    if (!query) return [];
    const res = await this.pool.query<Row & { score: number }>(
      `SELECT ${SELECT_FIELDS}, word_similarity($3, "searchText") AS score FROM mxik_code
       WHERE ${PositionStore.SCOPE} ORDER BY score DESC, code LIMIT $4`,
      [this.prefix, this.exclude, query, limit],
    );
    return res.rows.map((r) => ({ candidate: toCandidate(r), score: Number(r.score) }));
  }

  /** Anchoring is for search over the whole classifier: within one position every code is ranked already. */
  async byFullText(query: string, limit: number, opts: { anchored?: boolean } = {}): Promise<{ candidate: MxikCandidate; score: number }[]> {
    if (opts.anchored) return [];
    const words = query.split(/[\s®™©]+/).map((t) => t.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()).filter(Boolean);
    if (words.length === 0) return [];
    const res = await this.pool.query<Row & { score: number }>(
      `SELECT ${SELECT_FIELDS}, ts_rank_cd("searchVector", q) AS score
       FROM mxik_code, to_tsquery('simple', $3) AS q
       WHERE ${PositionStore.SCOPE} AND "searchVector" @@ q ORDER BY score DESC, code LIMIT $4`,
      [this.prefix, this.exclude, words.join(' | '), limit],
    );
    return res.rows.map((r) => ({ candidate: toCandidate(r), score: Number(r.score) }));
  }

  byVector(): Promise<{ candidate: MxikCandidate; score: number }[]> {
    return Promise.resolve([]);
  }

  async byCode(code: string): Promise<MxikCandidate | null> {
    const res = await this.pool.query<Row>(
      `SELECT ${SELECT_FIELDS} FROM mxik_code WHERE ${PositionStore.SCOPE} AND code = $3`, [this.prefix, this.exclude, code],
    );
    const row = res.rows[0];
    return row ? toCandidate(row) : null;
  }

  /** The position's base code is what is being replaced, so it is never offered. */
  baseCodeFor(): Promise<MxikCandidate | null> {
    return Promise.resolve(null);
  }

  async liveCodes(codes: readonly string[]): Promise<Set<string>> {
    if (codes.length === 0) return new Set();
    const res = await this.pool.query<{ code: string }>(
      `SELECT code FROM mxik_code WHERE ${PositionStore.SCOPE} AND code = ANY($3::char(17)[])`, [this.prefix, this.exclude, codes],
    );
    return new Set(res.rows.map((r) => r.code.trim()));
  }
}
