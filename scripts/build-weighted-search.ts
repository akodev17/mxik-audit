// Fills mxik_code."searchVectorWeighted" for a classifier that was loaded
// before the weighted_search_vector migration, then builds its GIN index
// concurrently. Every name it needs is already in the row, so no export is
// downloaded. Resumable: only rows still NULL are written (--rebuild redoes all).
// Run: npm run search:weighted [-- --dry-run --rebuild --batch 5000]
import '@tasnivo/domain/load-env'; // must precede anything reading process.env
import { Client } from 'pg';
import { weightedSearchText, weightedVectorSql, type CodeNames } from '@tasnivo/core/match/search-document';
import { ensureWeightedIndex, hasWeightedColumn } from './lib/weighted-search.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';
const DRY_RUN = process.argv.includes('--dry-run');
const REBUILD = process.argv.includes('--rebuild');
const batchArg = process.argv.indexOf('--batch');
const BATCH = batchArg >= 0 ? Number(process.argv[batchArg + 1]) : 5000;

const NAME_COLUMNS = [
  'nameUz', 'nameRu',
  'subPositionNameUz', 'subPositionNameRu', 'subPositionNameUzCyrl',
  'positionNameUz', 'positionNameRu', 'positionNameUzCyrl',
  'classNameUz', 'classNameRu', 'classNameUzCyrl',
  'groupNameUz', 'groupNameRu', 'groupNameUzCyrl',
  'brandNameUz', 'brandNameRu', 'brandNameUzCyrl',
  'attributeNameUz', 'attributeNameRu', 'attributeNameUzCyrl',
] as const satisfies readonly (keyof CodeNames)[];

const log = (line: string): void => console.log(line);
const client = new Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  log(`database ${new URL(DATABASE_URL).pathname.slice(1)}${DRY_RUN ? ' (dry run: nothing is written)' : ''}`);
  if (!(await hasWeightedColumn(client))) {
    throw new Error('mxik_code has no "searchVectorWeighted" column: apply the weighted_search_vector migration first (prisma migrate deploy).');
  }
  const todo = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM mxik_code ${REBUILD ? '' : 'WHERE "searchVectorWeighted" IS NULL'}`,
  );
  log(`rows to fill: ${Number(todo.rows[0]?.n ?? 0).toLocaleString()}`);

  const select = NAME_COLUMNS.map((c) => `"${c}"`).join(', ');
  const t0 = Date.now();
  let after = '';
  let written = 0;
  for (;;) {
    const res = await client.query<CodeNames & { code: string }>(
      `SELECT code, ${select} FROM mxik_code
       WHERE code > $1 ${REBUILD ? '' : 'AND "searchVectorWeighted" IS NULL'}
       ORDER BY code LIMIT $2`,
      [after, BATCH],
    );
    if (res.rows.length === 0) break;
    after = res.rows[res.rows.length - 1]?.code ?? after;
    const texts = res.rows.map((r) => weightedSearchText(r));
    if (DRY_RUN) {
      if (written === 0) {
        const sample = res.rows[0];
        log(`sample ${sample?.code}: ${JSON.stringify(texts[0])}`);
      }
      written += res.rows.length;
      continue;
    }
    const update = await client.query(
      `UPDATE mxik_code m SET "searchVectorWeighted" = ${weightedVectorSql('v.a', 'v.b', 'v.c', 'v.d')}
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]) AS v(code, a, b, c, d)
       WHERE m.code = v.code::char(17)`,
      [res.rows.map((r) => r.code), texts.map((t) => t.a), texts.map((t) => t.b), texts.map((t) => t.c), texts.map((t) => t.d)],
    );
    written += update.rowCount ?? 0;
    if (written % 50_000 < BATCH) log(`  ${written.toLocaleString()} rows, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  log(`${DRY_RUN ? 'would fill' : 'filled'} ${written.toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (!DRY_RUN) {
    await ensureWeightedIndex(client, log);
    await client.query('ANALYZE mxik_code');
    log('analyzed mxik_code');
  }
} finally {
  await client.end();
}
