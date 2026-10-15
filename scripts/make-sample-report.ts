// Runs the real audit on the landing page's sample catalogue and freezes the
// result into src/lib/sample-report.generated.ts. Also writes the same file to
// public/demo/namuna-katalog.xlsx, so what a visitor downloads (and can upload
// to the app) is exactly what produced the page's numbers.
//
// "Real" means the application's own path, end to end: the .xlsx is parsed by
// parseUpload, rows are stored as CatalogItems the way the upload action
// stores them, and auditCatalog — the function the app calls — runs the
// matching pipeline and the checks. The rows live in a temporary organisation
// that is deleted afterwards (cascades remove its catalogue and findings).
//
// Nothing shown on the landing page is typed by hand: every code, finding type,
// suggestion, confidence and total below comes out of this run, and the script
// refuses to write if any displayed code fails to resolve in the classifier.
//
// Run against a loaded and embedded classifier: npm run make:sample-report
// `-- --preview` prints the result without the embedding check and writes nothing.
// `-- --draft` skips the embedding check but writes, stamped as a draft; the
// test suite fails on a draft, so one cannot be committed by accident.
// `-- --source=prisma/demo-catalog.json` audits the demo's catalogue instead
// (same headers and column layout), so the landing's numbers equal the demo's.
import '../src/lib/load-env.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { readCode, type FindingType } from '../src/core/audit/checks.js';
import { normalizeName } from '../src/core/normalize/index.js';
import { auditCatalog, lookupCode } from '../src/lib/audit-runner.js';
import { db } from '../src/lib/db.js';
import { parseUpload } from '../src/lib/spreadsheet.js';
import {
  SAMPLE_FILENAME, SAMPLE_HEADERS, SAMPLE_MAPPING, SAMPLE_ROWS, sampleWorkbook,
} from './landing-sample/catalog.js';

const TYPES: readonly FindingType[] = ['MISMATCH', 'MISSING', 'NOT_FOUND', 'UNIT_CONFLICT'];
/** Shown rows per finding type. The first of each type comes first, so the
 *  hero, which shows four rows, gets one of every type. */
const PER_TYPE = 2;
const PREVIEW = process.argv.includes('--preview');
const DRAFT = process.argv.includes('--draft');
const SOURCE = process.argv.find((a) => a.startsWith('--source='))?.slice('--source='.length)
  ?? 'scripts/landing-sample/catalog.ts';

/** The rows to audit: the landing sample, or a JSON fixture in the same layout. */
function sourceRows(): readonly (readonly string[])[] {
  if (!SOURCE.endsWith('.json')) return SAMPLE_ROWS;
  const fixture = JSON.parse(readFileSync(SOURCE, 'utf8')) as {
    headers?: unknown; columnMap?: unknown; rows?: unknown;
  };
  if (JSON.stringify(fixture.headers) !== JSON.stringify(SAMPLE_HEADERS)
      || JSON.stringify(fixture.columnMap) !== JSON.stringify(SAMPLE_MAPPING)
      || !Array.isArray(fixture.rows)) {
    throw new Error(`${SOURCE} does not use the sample's headers and column layout`);
  }
  return fixture.rows as string[][];
}

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik',
  max: 2,
});

// ------------------------------------------------------------ the classifier
// The page's classifier facts come from the same database the sample ran
// against, so the page can never quote one snapshot and audit with another.
const stats = (await pool.query<{
  codes: string; subpositions: string; strict: string; marked: string; units: string;
}>(`
  SELECT count(*)::text AS codes,
         count(DISTINCT "subPositionCode")::text AS subpositions,
         count(*) FILTER (WHERE "unitBinding" = 'strict')::text AS strict,
         count(*) FILTER (WHERE "isMarked")::text AS marked,
         (SELECT count(DISTINCT u) FROM mxik_code, unnest("unitCanonical") u)::text AS units
  FROM mxik_code WHERE "retiredAt" IS NULL
`)).rows[0];
const snapshot = (await pool.query<{ takenAt: Date }>(
  'SELECT "takenAt" FROM catalog_snapshot ORDER BY "takenAt" DESC LIMIT 1',
)).rows[0];
const embedded = (await pool.query<{ provider: string; rowsEmbedded: number }>(
  'SELECT provider, "rowsEmbedded" FROM embedding_state WHERE id = 1',
)).rows[0];
if (!stats || Number(stats.codes) === 0 || !snapshot) {
  throw new Error('The classifier is empty. Run `npm run load:db` first.');
}
if (!PREVIEW && !DRAFT && (!embedded || Number(embedded.rowsEmbedded) < Number(stats.codes))) {
  throw new Error('Embeddings are missing or incomplete. Run `npm run embed:catalog` first.');
}

// ------------------------------------------------- the file, as the app reads it
const buffer = await sampleWorkbook(sourceRows());
if (!PREVIEW) writeFileSync(`public/demo/${SAMPLE_FILENAME}`, buffer);
const parsed = await parseUpload(buffer, SAMPLE_FILENAME);
if (parsed.headers.join('|') !== SAMPLE_HEADERS.join('|')) {
  throw new Error(`Unexpected headers after parsing: ${parsed.headers.join(' | ')}`);
}

const pick = (row: readonly string[], index: number): string | null => {
  const value = row[index];
  return value === undefined || value.trim() === '' ? null : value.trim();
};

// --------------------------------------------- audit it in a throwaway org
const org = await db.organization.create({ data: { name: 'landing-sample (temporary)' } });
let result;
try {
  const catalog = await db.catalog.create({
    data: {
      orgId: org.id,
      filename: SAMPLE_FILENAME,
      rowCount: parsed.rows.length,
      headers: parsed.headers,
      columnMap: { ...SAMPLE_MAPPING },
      status: 'analyzing',
    },
  });
  // Same derivation as deriveItem in src/app/actions/catalog.ts.
  await db.catalogItem.createMany({
    data: parsed.rows.map((row, rowIndex) => {
      const rawName = pick(row, SAMPLE_MAPPING.name) ?? '';
      const priceRaw = pick(row, SAMPLE_MAPPING.price);
      const price = priceRaw === null ? null : Number(priceRaw.replace(/[^\d.,-]/g, '').replace(',', '.'));
      return {
        catalogId: catalog.id,
        rowIndex,
        rawName,
        normalizedName: normalizeName(rawName).matchKey,
        barcode: pick(row, SAMPLE_MAPPING.barcode),
        existingMxik: readCode(pick(row, SAMPLE_MAPPING.mxik)),
        unit: pick(row, SAMPLE_MAPPING.unit),
        price: price !== null && Number.isFinite(price) ? price : null,
        attrs: { original: [...row] },
      };
    }),
  });

  const outcome = await auditCatalog(catalog.id);

  const findings = await db.finding.findMany({
    where: { item: { catalogId: catalog.id } },
    include: { item: { select: { rowIndex: true, rawName: true, existingMxik: true, unit: true } } },
    orderBy: [{ item: { rowIndex: 'asc' } }, { type: 'asc' }],
  });
  result = { outcome, findings, rowCount: parsed.rows.length };
} finally {
  await db.organization.delete({ where: { id: org.id } });
}

const { outcome, findings, rowCount } = result;

// ----------------------------------------------------------------- the totals
const byType = Object.fromEntries(TYPES.map((t) => [t, 0])) as Record<FindingType, number>;
for (const f of findings) byType[f.type]++;
const riskyRows = new Set(findings.map((f) => f.item.rowIndex)).size;

// ------------------------------------------------------- the rows to display
// Rule, fixed in advance: the first PER_TYPE findings of each type in file
// order, interleaved so the first four rows are one of each type. Not the
// best-scoring ones — whatever the file order gives.
const queues = TYPES.map((t) => findings.filter((f) => f.type === t).slice(0, PER_TYPE));
const chosen = [];
for (let round = 0; round < PER_TYPE; round++) {
  for (const q of queues) {
    const f = q[round];
    if (f) chosen.push(f);
  }
}

type SampleRow = {
  type: FindingType;
  productName: string;
  unit: string | null;
  currentMxik: string | null;
  /** Classifier name of the current code; null when absent or not in the classifier. */
  currentName: string | null;
  suggestedMxik: string | null;
  suggestedName: string | null;
  /** UNIT_CONFLICT only: the unit the code is strictly bound to. */
  requiredUnit: string | null;
  confidence: number | null;
  reason: string;
};

const rows: SampleRow[] = [];
for (const f of chosen) {
  const current = f.item.existingMxik ? await lookupCode(f.item.existingMxik) : null;
  const suggested = f.suggestedMxik ? await lookupCode(f.suggestedMxik) : null;

  // The guarantees the landing page relies on. Fail loudly rather than publish.
  if (f.suggestedMxik && !suggested) throw new Error(`suggested ${f.suggestedMxik} is not in the classifier`);
  if (f.type === 'NOT_FOUND' && current) throw new Error(`NOT_FOUND row's code ${f.item.existingMxik} exists`);
  if (f.type !== 'NOT_FOUND' && f.item.existingMxik && !current) {
    throw new Error(`current ${f.item.existingMxik} is not in the classifier`);
  }

  rows.push({
    type: f.type,
    productName: f.item.rawName,
    unit: f.item.unit,
    currentMxik: f.item.existingMxik,
    currentName: current?.nameUz ?? null,
    suggestedMxik: f.suggestedMxik,
    suggestedName: suggested?.nameUz ?? null,
    requiredUnit: f.type === 'UNIT_CONFLICT' ? (current?.unitCanonical[0] ?? null) : null,
    confidence: f.confidence,
    reason: f.reason,
  });
}

const fmtDate = (d: Date): string =>
  `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

const payload = {
  generatedAt: fmtDate(new Date()),
  source: SOURCE,
  pipeline: {
    degraded: outcome.degraded,
    degradedReasons: outcome.degradedReasons,
    embeddings: DRAFT ? 'DRAFT — embeddings incomplete, regenerate' : (embedded?.provider ?? 'none'),
  },
  classifier: {
    snapshot: fmtDate(snapshot.takenAt),
    codes: Number(stats.codes),
    subpositions: Number(stats.subpositions),
    strictUnitCodes: Number(stats.strict),
    markedCodes: Number(stats.marked),
    canonicalUnits: Number(stats.units),
  },
  totalRows: rowCount,
  riskyRows,
  byType,
  rows,
};

const file = `// GENERATED by scripts/make-sample-report.ts — do not edit by hand.
//
// The real audit (parseUpload → auditCatalog) run on the invented sample
// catalogue in scripts/landing-sample/catalog.ts, against the classifier
// snapshot recorded below. Every code, finding, suggestion, confidence and
// total is what the pipeline produced; the script checked that every shown
// code resolves in the classifier before writing this file.

export type SampleFindingType = 'MISSING' | 'NOT_FOUND' | 'MISMATCH' | 'UNIT_CONFLICT';

export type SampleRow = {
  type: SampleFindingType;
  productName: string;
  unit: string | null;
  currentMxik: string | null;
  currentName: string | null;
  suggestedMxik: string | null;
  suggestedName: string | null;
  requiredUnit: string | null;
  confidence: number | null;
  reason: string;
};

export const SAMPLE_REPORT: {
  generatedAt: string;
  source: string;
  pipeline: { degraded: boolean; degradedReasons: string[]; embeddings: string };
  classifier: {
    snapshot: string; codes: number; subpositions: number;
    strictUnitCodes: number; markedCodes: number; canonicalUnits: number;
  };
  totalRows: number;
  riskyRows: number;
  byType: Record<SampleFindingType, number>;
  rows: SampleRow[];
} = ${JSON.stringify(payload, null, 2)};
`;

if (!PREVIEW) {
  writeFileSync('src/lib/sample-report.generated.ts', file);
  console.log(`wrote src/lib/sample-report.generated.ts and public/demo/${SAMPLE_FILENAME}`);
} else {
  console.log('preview only — nothing written');
  for (const r of rows) console.log(`    ${r.type} | ${r.productName} | now: ${r.currentName ?? '-'} | fix: ${r.suggestedName ?? r.requiredUnit ?? '-'}`);
}
console.log(`  classifier ${payload.classifier.codes} codes, snapshot ${payload.classifier.snapshot}`);
console.log(`  pipeline degraded: ${outcome.degraded} (${outcome.degradedReasons.join('; ') || '—'})`);
console.log(`  ${riskyRows} risky of ${rowCount} rows; ${JSON.stringify(byType)}`);
for (const f of findings) {
  const shown = chosen.includes(f) ? '*' : ' ';
  console.log(`  ${shown} ${String(f.item.rowIndex + 2).padStart(3)} ${f.type.padEnd(13)} ${f.item.rawName.padEnd(36).slice(0, 36)} ${f.item.existingMxik ?? '-'.padEnd(17)} → ${f.suggestedMxik ?? '—'} ${f.confidence === null ? '' : f.confidence.toFixed(2)}`);
}
await pool.end();
await db.$disconnect();
