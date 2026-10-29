import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { Pool } from 'pg';
import { isTransient, PostgresCandidateStore, SCOPED_SCAN_MAX, storeRetryCount, WEIGHTED_INDEX } from './store.js';

/** A pool whose query() fails with the given errors, in order, then answers. */
function flakyPool(errors: Error[]): { pool: Pool; calls: () => number } {
  let calls = 0;
  const pool = {
    query: () => {
      calls++;
      const next = errors.shift();
      return next ? Promise.reject(next) : Promise.resolve({ rows: [{ retiredAt: null }] });
    },
  } as unknown as Pool;
  return { pool, calls: () => calls };
}

describe('PostgresCandidateStore retries', () => {
  it('runs a read again once after a dropped connection', async () => {
    const before = storeRetryCount();
    const { pool, calls } = flakyPool([Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })]);
    const result = await new PostgresCandidateStore(pool).exists('01701001002000000');
    assert.deepEqual(result, { found: true, retired: false });
    assert.equal(calls(), 2);
    assert.equal(storeRetryCount(), before + 1);
  });

  it('does not retry a real query error', async () => {
    const { pool, calls } = flakyPool([Object.assign(new Error('syntax error'), { code: '42601' })]);
    await assert.rejects(new PostgresCandidateStore(pool).exists('01701001002000000'), /syntax error/);
    assert.equal(calls(), 1);
  });

  it('gives up after one retry', async () => {
    const reset = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const { pool, calls } = flakyPool([reset(), reset()]);
    await assert.rejects(new PostgresCandidateStore(pool).exists('01701001002000000'), /ECONNRESET/);
    assert.equal(calls(), 2);
  });

  it('knows which failures are transient', () => {
    assert.equal(isTransient({ code: 'ECONNRESET' }), true);
    assert.equal(isTransient({ code: '57P01' }), true);
    assert.equal(isTransient({ code: '23505' }), false);
    assert.equal(isTransient(new Error('x')), false);
  });
});

/**
 * A pool that answers the term-statistics query and records full-text queries.
 * `weighted` says whether the weighted column's index is built and valid.
 */
function statsPool(
  stats: Record<string, number> | Error, weighted = false,
): { pool: Pool; searches: unknown[][]; sqls: string[]; statLoads: () => number; statParams: unknown[][] } {
  const searches: unknown[][] = [];
  const sqls: string[] = [];
  const statParams: unknown[][] = [];
  let statLoads = 0;
  const pool = {
    query: (sql: string, params: unknown[]) => {
      if (sql.includes('pg_index')) return Promise.resolve({ rows: weighted ? [{ valid: true }] : [] });
      if (sql.includes('ts_stat')) {
        statLoads++;
        statParams.push(params);
        if (stats instanceof Error) return Promise.reject(stats);
        return Promise.resolve({ rows: Object.entries(stats).map(([word, ndoc]) => ({ word, ndoc })) });
      }
      searches.push(params);
      sqls.push(sql);
      return Promise.resolve({ rows: [] });
    },
  } as unknown as Pool;
  return { pool, searches, sqls, statLoads: () => statLoads, statParams };
}

describe('PostgresCandidateStore full-text term selection', () => {
  it('ranks on every term but selects candidates only on the rare ones', async () => {
    const { pool, searches } = statsPool({ uchun: 117_000, elektr: 26_000 });
    await new PostgresCandidateStore(pool, { fullTextCommonDocs: 10_000 }).byFullText('elektr choynak uchun', 50);
    assert.deepEqual(searches[0], ['elektr | choynak | uchun', 50, 'choynak']);
  });

  it('selects on every term when all of them are common', async () => {
    const { pool, searches } = statsPool({ uchun: 117_000, va: 94_000 });
    await new PostgresCandidateStore(pool, { fullTextCommonDocs: 10_000 }).byFullText('uchun va', 50);
    assert.deepEqual(searches[0], ['uchun | va', 50, 'uchun | va']);
  });

  it('skips the statistics entirely when the cutoff is off', async () => {
    const { pool, searches, statLoads } = statsPool({ uchun: 117_000 });
    await new PostgresCandidateStore(pool, { fullTextCommonDocs: 0 }).byFullText('elektr uchun', 50);
    assert.deepEqual(searches[0], ['elektr | uchun', 50, 'elektr | uchun']);
    assert.equal(statLoads(), 0);
  });

  it('loads the statistics once per pool', async () => {
    const { pool, statLoads } = statsPool({ uchun: 117_000 });
    await Promise.all([1, 2, 3].map(() => new PostgresCandidateStore(pool).byFullText('elektr uchun', 50)));
    assert.equal(statLoads(), 1);
  });

  it('stays on the plain column until the weighted index is built', async () => {
    const { pool, sqls } = statsPool({}, false);
    const store = new PostgresCandidateStore(pool, { fullTextColumn: 'weighted' });
    assert.equal(await store.fullTextSource(), 'searchVector');
    await store.byFullText('list goryachekataniy', 50);
    assert.match(sqls[0] ?? '', /"searchVector" @@ f/);
  });

  it('on the weighted column, selects on leaf-name words and ranks with the hierarchy weights', async () => {
    const { pool, searches, sqls, statParams } = statsPool({ list: 30_000 }, true);
    const store = new PostgresCandidateStore(pool, { fullTextCommonDocs: 10_000, fullTextColumn: 'weighted' });
    assert.equal(await store.fullTextSource(), 'searchVectorWeighted');
    await store.byFullText('list goryachekataniy', 50);
    assert.match(sqls[0] ?? '', /"searchVectorWeighted" @@ f/);
    assert.match(sqls[0] ?? '', /ts_rank_cd\(\$4::float4\[\], "searchVectorWeighted", q\)/);
    // "list" is common among leaf names, so only the rare word selects, and only as a leaf word.
    assert.deepEqual(searches[0], ['list | goryachekataniy', 50, 'goryachekataniy:A', [0.0125, 0.025, 0.05, 0.1], ['list', 'goryachekataniy']]);
    // Term counts are taken over the selecting weight only.
    assert.equal(statParams[0]?.[2], 'A');
  });

  it('can let position words select too, and can be forced back to the plain column', async () => {
    const ab = statsPool({}, true);
    await new PostgresCandidateStore(ab.pool, { fullTextColumn: 'weighted', fullTextSelectWeights: 'AB' }).byFullText('armatura', 50);
    assert.equal(ab.searches[0]?.[2], 'armatura:AB');
    const plain = statsPool({}, true);
    const store = new PostgresCandidateStore(plain.pool, { fullTextColumn: 'plain' });
    assert.equal(await store.fullTextSource(), 'searchVector');
    await store.byFullText('armatura', 50);
    assert.match(plain.sqls[0] ?? '', /"searchVector" @@ f/);
  });

  it('falls back to every term when the statistics fail, and retries later', async () => {
    const { pool, searches, statLoads } = statsPool(new Error('canceling statement'));
    const store = new PostgresCandidateStore(pool, { fullTextCommonDocs: 10_000 });
    await store.byFullText('elektr uchun', 50);
    await store.byFullText('elektr uchun', 50);
    assert.deepEqual(searches[0], ['elektr | uchun', 50, 'elektr | uchun']);
    assert.equal(statLoads(), 2);
  });
});

describe('weighted full-text against the database', async () => {
  const pool = new Pool({
    connectionString: process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik',
    connectionTimeoutMillis: 1500,
    max: 2,
  });
  after(() => pool.end());

  let skip: string | false = 'database not available';
  try {
    const r = await pool.query<{ valid: boolean }>(
      'SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1',
      [WEIGHTED_INDEX],
    );
    skip = r.rows[0]?.valid ? false : 'weighted full-text column not built here (npm run search:weighted)';
  } catch {
    // keep the "not available" reason
  }

  it('ranks a leaf-only hit exactly as the plain column does, so the score mapping keeps its meaning', { skip }, async () => {
    const weighted = await new PostgresCandidateStore(pool, { fullTextColumn: 'weighted' }).byFullText('kartoshka', 20);
    const plain = await new PostgresCandidateStore(pool, { fullTextColumn: 'plain' }).byFullText('kartoshka', 20);
    const leafOnly = weighted.find((h) => !h.hierarchyWords);
    assert.ok(leafOnly, 'some hit matched in its own name only');
    const same = plain.find((h) => h.candidate.code === leafOnly.candidate.code);
    if (same) assert.equal(leafOnly.score.toFixed(6), same.score.toFixed(6));
  });

  it('ranks a word of the position name, and says it came from the hierarchy', { skip }, async () => {
    // "нелегированной" is in position 07208001's name, not in its codes' own names.
    const query = 'list goryachekataniy nelegirovannoy';
    const hits = await new PostgresCandidateStore(pool, { fullTextColumn: 'weighted' }).byFullText(query, 20);
    const lifted = hits.filter((h) => h.hierarchyWords?.includes('nelegirovannoy'));
    assert.ok(lifted.length > 0, 'a hit reports the position word');
    for (const h of hits) for (const w of h.hierarchyWords ?? []) assert.ok(query.split(' ').includes(w), w);
    const plain = await new PostgresCandidateStore(pool, { fullTextColumn: 'plain' }).byFullText(query, 20);
    const before = plain.find((h) => h.candidate.code === lifted[0]?.candidate.code);
    if (before && lifted[0]) assert.ok(lifted[0].score > before.score, 'the hierarchy word adds to the rank');
  });
});

/** A pool whose dedicated client answers each search with `rows[i]` rows, in turn. */
function cascadePool(rowCounts: number[]): { pool: Pool; statements: string[] } {
  const statements: string[] = [];
  let search = 0;
  const client = {
    query: (sql: string) => {
      statements.push(sql.trim().split('\n')[0] ?? '');
      if (!sql.includes('word_similarity(')) return Promise.resolve({ rows: [] });
      const n = rowCounts[search++] ?? 0;
      return Promise.resolve({ rows: Array.from({ length: n }, (_, i) => ({ code: `0000000000000000${i}`.slice(-17), subPositionCode: '00000000000', score: 0.9 })) });
    },
    release: () => undefined,
  };
  const pool = { connect: () => Promise.resolve(client), query: () => Promise.reject(new Error('no pool queries')) } as unknown as Pool;
  return { pool, statements };
}

describe('PostgresCandidateStore trigram threshold cascade', () => {
  it('answers from the strict pass when it fills the limit', async () => {
    const { pool, statements } = cascadePool([50]);
    const hits = await new PostgresCandidateStore(pool, { lexicalStrictThreshold: 0.75 }).byLexical('truba vodogazoprovodnaya', 50);
    assert.equal(hits.length, 50);
    assert.deepEqual(statements.filter((s) => s.startsWith('SET')), ['SET LOCAL pg_trgm.word_similarity_threshold = 0.75']);
  });

  it('falls back to the default threshold when the strict pass comes back short', async () => {
    const { pool, statements } = cascadePool([3, 40]);
    const hits = await new PostgresCandidateStore(pool, { lexicalStrictThreshold: 0.75 }).byLexical('gipsokarton knauf', 50);
    assert.equal(hits.length, 40);
    assert.ok(statements.includes('SET LOCAL pg_trgm.word_similarity_threshold TO DEFAULT'));
  });

  it('accepts only a plain threshold in (0, 1]; anything else means one query at the default', async () => {
    const { pool, statements } = cascadePool([]);
    await assert.rejects(new PostgresCandidateStore(pool, { lexicalStrictThreshold: Number.NaN }).byLexical('x', 50), /no pool queries/);
    assert.equal(statements.length, 0);
  });
});

describe('trigram threshold cascade against the database', async () => {
  const pool = new Pool({
    connectionString: process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik',
    connectionTimeoutMillis: 1500,
    max: 2,
  });
  after(() => pool.end());
  let skip: string | false = 'database not available';
  try {
    const r = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM mxik_code WHERE "retiredAt" IS NULL');
    skip = Number(r.rows[0]?.n ?? 0) > 0 ? false : 'classifier not loaded';
  } catch {
    // keep the reason
  }

  it('returns exactly what the single default-threshold query returns', { skip }, async () => {
    const cascade = new PostgresCandidateStore(pool, { lexicalStrictThreshold: 0.75 });
    const single = new PostgresCandidateStore(pool, { lexicalStrictThreshold: null });
    // A common word (strict pass fills), a rare pair (falls back), a short name.
    for (const query of ['truba vodogazoprovodnaya', 'gipsokarton knauf', 'kartoshka']) {
      const a = await cascade.byLexical(query, 50);
      const b = await single.byLexical(query, 50);
      assert.deepEqual(a.map((h) => [h.candidate.code, h.score]), b.map((h) => [h.candidate.code, h.score]), query);
    }
  });

  it('scores codes by key exactly as the trigram and vector lists do', { skip }, async () => {
    const store = new PostgresCandidateStore(pool);
    const hits = await store.byLexical('truba vodogazoprovodnaya', 5);
    const byKey = await store.lexicalFor('truba vodogazoprovodnaya', hits.map((h) => h.candidate.code));
    for (const h of hits) assert.ok(Math.abs((byKey.get(h.candidate.code) ?? -1) - h.score) < 1e-6, h.candidate.code);
    const filled = await pool.query<{ v: string }>('SELECT "embeddingUz"::text AS v FROM mxik_code WHERE "embeddingUz" IS NOT NULL LIMIT 1');
    const vector = filled.rows[0] ? (JSON.parse(filled.rows[0].v) as number[]) : null;
    if (!vector) return; // no vectors loaded here
    const near = await store.byVector(vector, 5, 'uz');
    const cosines = await store.cosinesFor(vector, near.map((h) => h.candidate.code), 'uz');
    for (const h of near) assert.ok(Math.abs((cosines.get(h.candidate.code) ?? -1) - (h.cosine ?? 0)) < 1e-6, h.candidate.code);
    assert.deepEqual(await store.cosinesFor(vector, ['99999999999999999'], 'uz'), new Map());
  });
});

/**
 * A pool for a store limited to a code prefix: the prefix-size count answers
 * `size`, every other statement (pool or dedicated client) is recorded with its
 * parameters and answers nothing.
 */
function prefixPool(size: number, stats: Record<string, number> = {}): { pool: Pool; seen: { sql: string; params: unknown[] }[]; counts: () => number } {
  const seen: { sql: string; params: unknown[] }[] = [];
  let counts = 0;
  const query = (sql: string, params: unknown[] = []) => {
    if (sql.includes('count(*) AS n')) {
      counts++;
      return Promise.resolve({ rows: [{ n: String(size) }] });
    }
    if (sql.includes('ts_stat')) return Promise.resolve({ rows: Object.entries(stats).map(([word, ndoc]) => ({ word, ndoc })) });
    seen.push({ sql, params });
    return Promise.resolve({ rows: [] });
  };
  const client = { query, release: () => undefined };
  const pool = { query, connect: () => Promise.resolve(client) } as unknown as Pool;
  return { pool, seen, counts: () => counts };
}

describe('PostgresCandidateStore limited to a TN VED heading', () => {
  it('adds the prefix to exact, full-text and both trigram paths, and never to a known-code lookup', async () => {
    const { pool, seen } = prefixPool(15_000);
    const store = new PostgresCandidateStore(pool, { fullTextCommonDocs: 0, lexicalStrictThreshold: null }).withinPrefix('07306');
    await store.byMatchKey(['truba']);
    await store.byFullText('truba 57', 50);
    await store.byLexical('truba 57', 50);
    await store.byCode('07304001001000000');
    const [exact, fullText, lexical, byCode] = seen;
    assert.match(exact?.sql ?? '', /AND code LIKE \$2/);
    assert.deepEqual(exact?.params, [['truba'], '07306%']);
    assert.match(fullText?.sql ?? '', /AND code LIKE \$4/);
    assert.deepEqual(fullText?.params, ['truba | 57', 50, 'truba | 57', '07306%']);
    assert.match(lexical?.sql ?? '', /\$1 <% "searchText" AND "retiredAt" IS NULL AND code LIKE \$3/);
    assert.deepEqual(lexical?.params, ['truba 57', 50, '07306%']);
    assert.doesNotMatch(byCode?.sql ?? '', /LIKE/);
  });

  it('selects on the rare words first, and on every word when the heading has none of them', async () => {
    const { pool, seen } = prefixPool(15_000, { truba: 60_000 });
    await new PostgresCandidateStore(pool, { fullTextCommonDocs: 10_000 }).withinPrefix('07304').byFullText('truba 57', 50);
    assert.deepEqual(seen.map((q) => q.params[2]), ['57', 'truba | 57']);
    // The whole classifier never retries with the common words.
    const global = prefixPool(15_000, { truba: 60_000 });
    await new PostgresCandidateStore(global.pool, { fullTextCommonDocs: 10_000 }).byFullText('truba 57', 50);
    assert.deepEqual(global.seen.map((q) => q.params[2]), ['57']);
  });

  it('scores every code of a small heading, and scans its vectors exactly', async () => {
    const { pool, seen, counts } = prefixPool(SCOPED_SCAN_MAX);
    const store = new PostgresCandidateStore(pool).withinPrefix('08471');
    await store.byLexical('noutbuk', 50);
    await store.byVector([0.1, 0.2], 50, 'ru');
    assert.doesNotMatch(seen[0]?.sql ?? '', /<%/);
    assert.match(seen[0]?.sql ?? '', /WHERE score > 0/);
    assert.deepEqual(seen[0]?.params, ['noutbuk', 50, '08471%']);
    const vector = seen.find((s) => s.sql.includes('<=>'));
    assert.match(vector?.sql ?? '', /WITH s AS MATERIALIZED/);
    assert.deepEqual(vector?.params.slice(1), [50, '08471%']);
    assert.equal(seen.some((s) => s.sql.includes('hnsw')), false);
    // The heading's size is asked once per pool and prefix.
    assert.equal(counts(), 1);
  });

  it('walks the HNSW graph iteratively for a large heading', async () => {
    const { pool, seen } = prefixPool(SCOPED_SCAN_MAX + 1);
    await new PostgresCandidateStore(pool).withinPrefix('06810').byVector([0.1, 0.2], 50);
    const statements = seen.map((s) => s.sql);
    assert.ok(statements.includes('SET LOCAL hnsw.iterative_scan = relaxed_order'));
    assert.doesNotMatch(statements.find((s) => s.includes('<=>')) ?? '', /MATERIALIZED/);
  });

  it('accepts only digits as a prefix', () => {
    const { pool } = prefixPool(1);
    assert.throws(() => new PostgresCandidateStore(pool).withinPrefix('07%'), /not a code prefix/);
  });
});

describe('heading-limited retrieval against the database', async () => {
  const pool = new Pool({
    connectionString: process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik',
    connectionTimeoutMillis: 1500,
    max: 2,
  });
  after(() => pool.end());
  let skip: string | false = 'database not available';
  let vector: number[] | null = null;
  try {
    const r = await pool.query<{ v: string | null }>(
      `SELECT "embeddingRu"::text AS v FROM mxik_code WHERE code LIKE '07306%' AND "embeddingRu" IS NOT NULL AND "retiredAt" IS NULL LIMIT 1`,
    );
    const v = r.rows[0]?.v;
    vector = v ? (JSON.parse(v) as number[]) : null;
    skip = vector ? false : 'classifier or its vectors not loaded';
  } catch {
    // keep the reason
  }

  it('every stage returns codes of the heading only, a large heading filling the limit', { skip }, async () => {
    const store = new PostgresCandidateStore(pool).withinPrefix('07306');
    const lexical = await store.byLexical('truba profilnaya', 20);
    const fullText = await store.byFullText('truba profilnaya', 20);
    const vectors = await store.byVector(vector ?? [], 20, 'ru');
    for (const hits of [lexical, fullText, vectors]) {
      assert.ok(hits.length > 0);
      for (const h of hits) assert.ok(h.candidate.code.startsWith('07306'), h.candidate.code);
    }
    // 15k codes: the iterative scan keeps going until the limit is filled, nearest first.
    assert.equal(vectors.length, 20);
    for (let i = 1; i < vectors.length; i++) assert.ok((vectors[i - 1]?.score ?? 0) >= (vectors[i]?.score ?? 0));
  });

  it('a small heading is scanned: its codes rank for a name the trigram threshold would drop', { skip }, async () => {
    const store = new PostgresCandidateStore(pool).withinPrefix('08471');
    const hits = await store.byLexical('noutbuk 15', 10);
    assert.ok(hits.length > 0);
    for (const h of hits) assert.ok(h.candidate.code.startsWith('08471'), h.candidate.code);
    const vectors = await store.byVector(vector ?? [], 10, 'ru');
    assert.equal(vectors.length, 10);
    for (const h of vectors) assert.ok(h.candidate.code.startsWith('08471'), h.candidate.code);
  });
});
