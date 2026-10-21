// HNSW parameters for the vector columns, shared by embed:catalog and
// vectors:reindex. e5 puts the thousands of near-identical identifying codes of
// one position (pipe sizes) almost on top of each other, and pgvector's default
// graph (m=16, ef_construction=64) left whole positions unreachable: mean
// recall@50 against an exact scan 0.47 on the metal eval rows, some queries 0
// (2026-10-22, `npm run eval:recall`). m=32, ef_construction=200 with
// hnsw.ef_search 1000 (store.ts): 0.95, 13 ms per query against 705 ms exact;
// ~2 min and 871 MB per column on 442,964 codes.
export const HNSW_M = 32;
export const HNSW_EF_CONSTRUCTION = 200;

export type VectorColumnName = 'embeddingUz' | 'embeddingRu';

export const hnswIndexName = (column: VectorColumnName): string => `mxik_code_${column}_hnsw`;

/** The CREATE INDEX statement, optionally CONCURRENTLY and under another name. */
export function hnswIndexSql(column: VectorColumnName, options: { concurrently?: boolean; name?: string } = {}): string {
  return `CREATE INDEX ${options.concurrently ? 'CONCURRENTLY ' : ''}"${options.name ?? hnswIndexName(column)}" ON mxik_code
    USING hnsw ("${column}" vector_cosine_ops) WITH (m = ${HNSW_M}, ef_construction = ${HNSW_EF_CONSTRUCTION})`;
}
