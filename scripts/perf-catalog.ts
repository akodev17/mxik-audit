// End-to-end performance run on a large synthetic catalogue (default 60,000
// rows): build a real .xlsx, parse it as an upload, store the rows, audit them
// with per-stage timing, run the report's queries, and append the numbers to
// docs/perf-results.json. Uses a throwaway org that is deleted afterwards.
// Run: npm run perf [-- --rows 60000 --keep --label "..."]
import '@tasnivo/domain/load-env';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, totalmem } from 'node:os';
import ExcelJS from 'exceljs';
import { Pool } from 'pg';
import { readCode } from '@tasnivo/core/audit/checks';
import { embeddingProviderFromEnv } from '@tasnivo/core/embed/index';
import type { StageTimer } from '@tasnivo/core/match/pipeline';
import { checkVectorReadiness } from '@tasnivo/core/match/vector-readiness';
import { normalizeName } from '@tasnivo/core/normalize/index';
import { auditCatalog } from '@tasnivo/domain/audit-runner';
import { db } from '@tasnivo/db';
import { parseUpload } from '@tasnivo/domain/spreadsheet';
import { makeRng, noisify } from '../eval/noise.js';

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ROWS = Number(arg('--rows') ?? '60000');
const LABEL = arg('--label') ?? `${ROWS} rows`;
const KEEP = process.argv.includes('--keep');
const RESULTS = 'docs/perf-results.json';
const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';

const rng = makeRng(60_000);
const lap = (): (() => number) => { const t0 = performance.now(); return () => performance.now() - t0; };
const timings: Record<string, number> = {};

// ------------------------------------------------------------- generate
let elapsed = lap();
const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
const { rows: source } = await pool.query<{ code: string; nameUz: string; nameRu: string; barcode: string | null; unitCanonical: string[] }>(
  `SELECT code, "nameUz", "nameRu", barcode, "unitCanonical" FROM mxik_code
   WHERE "retiredAt" IS NULL AND length("nameUz") BETWEEN 6 AND 90
   ORDER BY md5(code || 'perf') LIMIT $1`,
  [ROWS],
);
const embedder = (await checkVectorReadiness(pool, embeddingProviderFromEnv())).embedder;
await pool.end();

const headers = ['Наименование', 'Штрих-код', 'ИКПУ', 'Ед. изм.', 'Цена'];
const data = source.map((r) => {
  const roll = rng();
  const name = noisify(rng() < 0.3 ? r.nameRu : r.nameUz, rng).name;
  const code = r.code.trim();
  // The mix a real catalogue shows: mostly right, some blank, dead or wrong.
  const mxik = roll < 0.15 ? '' : roll < 0.2 ? `${code.slice(0, 14)}999` : roll < 0.3 ? (source[Math.floor(rng() * source.length)]?.code.trim() ?? code) : code;
  const barcode = r.barcode && rng() < 0.3 ? r.barcode.trim().replace(/^0(?=\d{13}$)/, '') : '';
  return [name, barcode, mxik, r.unitCanonical[0] ?? 'dona', String((Math.floor(rng() * 200) + 1) * 500)];
});
const book = new ExcelJS.Workbook();
const sheet = book.addWorksheet('Katalog');
sheet.addRow(headers);
for (const row of data) sheet.addRow(row);
const buffer = Buffer.from(await book.xlsx.writeBuffer());
timings['generate'] = elapsed();
console.log(`generated ${data.length.toLocaleString()} rows, ${(buffer.length / 1e6).toFixed(1)} MB xlsx`);

// ------------------------------------------------------------- upload
elapsed = lap();
const parsed = await parseUpload(buffer, 'perf.xlsx');
timings['parse'] = elapsed();

elapsed = lap();
const org = await db.organization.create({ data: { name: `perf-${Date.now()}`, kind: 'internal' } });
const map = { name: 0, barcode: 1, mxik: 2, unit: 3, price: 4 };
const catalog = await db.catalog.create({
  data: { orgId: org.id, filename: 'perf.xlsx', rowCount: parsed.rows.length, status: 'analyzing', headers: parsed.headers, columnMap: map },
});
const cell = (row: string[], i: number): string | null => row[i]?.trim() || null;
for (let i = 0; i < parsed.rows.length; i += 1000) {
  await db.catalogItem.createMany({
    data: parsed.rows.slice(i, i + 1000).map((row, j) => {
      const rawName = cell(row, map.name) ?? '';
      return {
        catalogId: catalog.id, rowIndex: i + j, rawName, normalizedName: normalizeName(rawName).matchKey,
        barcode: cell(row, map.barcode), existingMxik: readCode(cell(row, map.mxik)), unit: cell(row, map.unit),
        price: Number(cell(row, map.price)) || null, attrs: { original: row },
      };
    }),
  });
}
timings['store'] = elapsed();
console.log(`parsed + stored ${parsed.rows.length.toLocaleString()} rows in ${((timings['parse'] + timings['store']) / 1000).toFixed(1)}s`);

// ------------------------------------------------------------- audit
const stages: Record<string, { ms: number; calls: number }> = {};
const timer: StageTimer = {
  add(stage, ms) {
    const s = (stages[stage] ??= { ms: 0, calls: 0 });
    s.ms += ms;
    s.calls++;
  },
};
elapsed = lap();
let lastLog = 0;
let watermark = 0;
let resumes = 0;
let outcome: Awaited<ReturnType<typeof auditCatalog>> | undefined;
// A dropped connection (Docker Desktop's port proxy does this under load) costs
// a resume from the last contiguous finished row, not hours of work.
while (!outcome) {
  const base = watermark;
  try {
    outcome = await auditCatalog(catalog.id, {
      timer,
      fromRow: base,
      onProgress: ({ done, total, watermark: w }) => {
        watermark = w;
        const now = performance.now();
        if (now - lastLog < 15_000 && base + done !== total) return;
        lastLog = now;
        const s = elapsed() / 1000;
        const rate = (base + done) / s;
        process.stderr.write(`  audited ${(base + done).toLocaleString()} / ${total.toLocaleString()}  ${rate.toFixed(1)} rows/s  ETA ${Math.round((total - base - done) / rate)}s\n`);
      },
    });
  } catch (error) {
    if (++resumes > 5) throw error;
    console.error(`  resuming from row ${watermark} after: ${error instanceof Error ? error.message : String(error)}`);
    await db.finding.deleteMany({ where: { item: { catalogId: catalog.id, rowIndex: { gte: watermark } } } });
  }
}
timings['audit'] = elapsed();
await db.catalog.update({ where: { id: catalog.id }, data: { status: 'ready' } });

// ------------------------------------------------------------- report
elapsed = lap();
await Promise.all([
  db.finding.groupBy({ by: ['type'], where: { item: { catalogId: catalog.id } }, _count: { _all: true } }),
  db.catalogItem.count({ where: { catalogId: catalog.id, findings: { some: {} } } }),
  db.finding.findMany({
    where: { item: { catalogId: catalog.id } },
    orderBy: [{ severity: 'asc' }, { confidence: 'asc' }], take: 300,
    include: { item: { select: { rowIndex: true, rawName: true, existingMxik: true, unit: true } } },
  }),
]);
timings['report'] = elapsed();

const total = Object.values(timings).reduce((a, b) => a + b, 0) - (timings['generate'] ?? 0);
const result = {
  label: LABEL,
  ranAt: new Date().toISOString(),
  machine: { cpu: cpus()[0]?.model, threads: availableParallelism(), memGb: Math.round(totalmem() / 1e9) },
  rows: parsed.rows.length,
  embedder: embedder.name,
  findings: await db.finding.count({ where: { item: { catalogId: catalog.id } } }),
  resumes,
  degradedReasons: outcome.degradedReasons,
  secondsUploadToReport: Number((total / 1000).toFixed(1)),
  steps: Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, Number((v / 1000).toFixed(1))])),
  auditRowsPerSecond: Number((parsed.rows.length / ((timings['audit'] ?? 1) / 1000)).toFixed(1)),
  // Summed over 8 concurrent workers, so they add up to more than wall time.
  stageMsPerRow: Object.fromEntries(Object.entries(stages).map(([k, s]) => [k, Number((s.ms / parsed.rows.length).toFixed(2))])),
  stageCalls: Object.fromEntries(Object.entries(stages).map(([k, s]) => [k, s.calls])),
};
console.log(JSON.stringify(result, null, 2));

const history = existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, 'utf8')) as { runs: unknown[] }) : { runs: [] };
history.runs.push(result);
writeFileSync(RESULTS, JSON.stringify({ note: 'Append-only history of `npm run perf`.', runs: history.runs }, null, 2) + '\n');

if (!KEEP) await db.organization.delete({ where: { id: org.id } });
await db.$disconnect();
console.log(`appended to ${RESULTS}${KEEP ? `; kept org ${org.id}` : '; perf org deleted'}`);
