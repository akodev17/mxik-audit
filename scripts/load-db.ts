// Streams data/mxik.ndjson into Postgres via COPY, computing the retrieval
// columns (folded match keys, search text, resolved unit ids) on the way in.
// Also records a CatalogSnapshot and marks codes that vanished since the last
// import — the only mechanism available for deprecation (docs/gate0-report.md §3).
// Run: npm run load:db
import '../src/lib/load-env.js'; // must precede anything reading process.env
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { Client } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { indexKeys, matchKeyOf } from '../src/core/normalize/index.js';
import { resolveUnit } from '../src/core/normalize/units.js';

const SOURCE = 'data/mxik.ndjson';
const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';

type Rec = {
  code: string;
  groupCode: string; classCode: string; positionCode: string;
  subPositionCode: string; brandCode: string;
  nameUz: string | null; nameRu: string | null; nameUzCyrl: string | null;
  groupNameUz: string | null; groupNameRu: string | null; groupNameUzCyrl: string | null;
  classNameUz: string | null; classNameRu: string | null; classNameUzCyrl: string | null;
  positionNameUz: string | null; positionNameRu: string | null; positionNameUzCyrl: string | null;
  subPositionNameUz: string | null; subPositionNameRu: string | null; subPositionNameUzCyrl: string | null;
  brandNameUz: string | null; brandNameRu: string | null; brandNameUzCyrl: string | null;
  attributeNameUz: string | null; attributeNameRu: string | null; attributeNameUzCyrl: string | null;
  barcode: string | null;
  unitRaw: string | null;
  unitCanonical: string[];
  unitContainer: string | null;
  unitQuantity: number | null;
  unitBinding: 'strict' | 'recommended' | 'none';
  recommendedUnits: string[];
  recommendedUnitGroups: string[];
  packagesRaw: string | null;
  taxPrivilegeIds: string[];
  isBase: boolean;
  isMarked: boolean | null;
};

const COLUMNS = [
  'code', 'groupCode', 'classCode', 'positionCode', 'subPositionCode', 'brandCode',
  'nameUz', 'nameRu', 'nameUzCyrl',
  'groupNameUz', 'groupNameRu', 'groupNameUzCyrl',
  'classNameUz', 'classNameRu', 'classNameUzCyrl',
  'positionNameUz', 'positionNameRu', 'positionNameUzCyrl',
  'subPositionNameUz', 'subPositionNameRu', 'subPositionNameUzCyrl',
  'brandNameUz', 'brandNameRu', 'brandNameUzCyrl',
  'attributeNameUz', 'attributeNameRu', 'attributeNameUzCyrl',
  'barcode', 'unitRaw', 'unitCanonical', 'unitIds', 'unitContainer', 'unitQuantity',
  'unitBinding', 'recommendedUnits', 'recommendedUnitGroups', 'packagesRaw',
  'taxPrivilegeIds', 'isBase', 'isMarked', 'matchKeys', 'searchText',
] as const;

/** Postgres array literal. Quote every element so separators stay literal. */
function pgArray(items: readonly (string | number)[]): string {
  if (items.length === 0) return '{}';
  const inner = items.map((raw) => {
    const s = String(raw).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${s}"`;
  });
  return `{${inner.join(',')}}`;
}

/** CSV field. Unquoted empty means NULL; a quoted empty means empty string. */
function csv(value: string | number | boolean | null): string {
  if (value === null) return '';
  const s = String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/** GTIN to 14 digits, or null when the length is not a valid GTIN. */
function padBarcode(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  return digits.padStart(14, '0');
}

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

// Previous snapshot, so vanished codes can be flagged.
const prev = await client.query<{ code: string }>('SELECT code FROM mxik_code WHERE "retiredAt" IS NULL');
const previousCodes = new Set(prev.rows.map((r) => r.code.trim()));
console.log(`existing live codes in db: ${previousCodes.size.toLocaleString()}`);

await client.query('BEGIN');
await client.query('CREATE TEMP TABLE mxik_load (LIKE mxik_code INCLUDING DEFAULTS) ON COMMIT DROP');
await client.query('ALTER TABLE mxik_load DROP COLUMN "searchVector"');

const quoted = COLUMNS.map((c) => `"${c}"`).join(', ');
const copy = client.query(copyFrom(`COPY mxik_load (${quoted}) FROM STDIN WITH (FORMAT csv)`));

let rows = 0;
let barcodesDropped = 0;
let unitsUnresolved = 0;
const seenCodes = new Set<string>();

async function* generateCsv(): AsyncGenerator<string> {
  const rl = createInterface({ input: createReadStream(SOURCE, 'utf8'), crlfDelay: Infinity });
  let buffer = '';
  for await (const line of rl) {
    if (!line) continue;
    const r = JSON.parse(line) as Rec;

    const nameUz = r.nameUz ?? '';
    const nameRu = r.nameRu ?? '';
    const nameUzCyrl = r.nameUzCyrl ?? '';

    // Every folded spelling any of the three names could be typed as.
    const keys = new Set<string>();
    for (const n of [nameUz, nameRu, nameUzCyrl]) {
      if (n) for (const k of indexKeys(n)) keys.add(k);
    }

    // Retrieval text is folded, because queries are folded before they hit it.
    // Only the two names: the Uzbek name already contains its own brand,
    // attribute and subposition text, and the Cyrillic name folds to nearly the
    // same Latin (97.9% per npm run eval:translit). Including them tripled the
    // field length and diluted trigram similarity below its threshold —
    // "sement" matched zero rows before this was trimmed. The Cyrillic name's
    // fold still reaches matchKeys, so exact matching keeps that recall.
    const searchText = [matchKeyOf(nameUz), matchKeyOf(nameRu)]
      .filter(Boolean).join(' ');

    const unitIds = [...new Set(r.unitCanonical.map((u) => resolveUnit(u)?.id).filter((id): id is number => id !== undefined))];
    if (r.unitCanonical.length > 0 && unitIds.length === 0) unitsUnresolved++;

    const barcode = padBarcode(r.barcode);
    if (r.barcode && !barcode) barcodesDropped++;

    seenCodes.add(r.code);
    rows++;

    buffer += [
      csv(r.code), csv(r.groupCode), csv(r.classCode), csv(r.positionCode),
      csv(r.subPositionCode), csv(r.brandCode),
      csv(nameUz), csv(nameRu), csv(nameUzCyrl),
      csv(r.groupNameUz), csv(r.groupNameRu), csv(r.groupNameUzCyrl),
      csv(r.classNameUz), csv(r.classNameRu), csv(r.classNameUzCyrl),
      csv(r.positionNameUz), csv(r.positionNameRu), csv(r.positionNameUzCyrl),
      csv(r.subPositionNameUz), csv(r.subPositionNameRu), csv(r.subPositionNameUzCyrl),
      csv(r.brandNameUz), csv(r.brandNameRu), csv(r.brandNameUzCyrl),
      csv(r.attributeNameUz), csv(r.attributeNameRu), csv(r.attributeNameUzCyrl),
      csv(barcode), csv(r.unitRaw), csv(pgArray(r.unitCanonical)), csv(pgArray(unitIds)),
      csv(r.unitContainer), csv(r.unitQuantity),
      csv(r.unitBinding), csv(pgArray(r.recommendedUnits)), csv(pgArray(r.recommendedUnitGroups)),
      csv(r.packagesRaw), csv(pgArray(r.taxPrivilegeIds)),
      csv(r.isBase), csv(r.isMarked), csv(pgArray([...keys])), csv(searchText),
    ].join(',') + '\n';

    if (buffer.length > 1 << 20) { yield buffer; buffer = ''; }
    if (rows % 100_000 === 0) process.stderr.write(`  prepared ${rows.toLocaleString()} rows\n`);
  }
  if (buffer) yield buffer;
}

await pipeline(Readable.from(generateCsv()), copy);
console.log(`copied ${rows.toLocaleString()} rows into temp table`);

// Upsert into the real table, then retire anything the new import dropped.
await client.query(`
  INSERT INTO mxik_code (${quoted}, "importedAt")
  SELECT ${quoted}, now() FROM mxik_load
  ON CONFLICT (code) DO UPDATE SET
    ${COLUMNS.filter((c) => c !== 'code').map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')},
    "importedAt" = now(), "retiredAt" = NULL
`);

const retired = [...previousCodes].filter((c) => !seenCodes.has(c));
if (retired.length > 0) {
  await client.query('UPDATE mxik_code SET "retiredAt" = now() WHERE code = ANY($1::char(17)[])', [retired]);
}
await client.query(
  'INSERT INTO catalog_snapshot ("codeCount", source, "retiredCodes") VALUES ($1, $2, $3)',
  [rows, SOURCE, retired],
);
await client.query('COMMIT');

await client.query('ANALYZE mxik_code');
const counts = await client.query<{ total: string; live: string; withBarcode: string; strict: string; marked: string }>(`
  SELECT count(*)::text AS total,
         count(*) FILTER (WHERE "retiredAt" IS NULL)::text AS live,
         count(*) FILTER (WHERE barcode IS NOT NULL)::text AS "withBarcode",
         count(*) FILTER (WHERE "unitBinding" = 'strict')::text AS strict,
         count(*) FILTER (WHERE "isMarked")::text AS marked
  FROM mxik_code
`);
const keyStats = await client.query<{ avgkeys: string; maxkeys: string }>(
  'SELECT round(avg(array_length("matchKeys",1)),2)::text AS avgkeys, max(array_length("matchKeys",1))::text AS maxkeys FROM mxik_code',
);

const c = counts.rows[0];
const k = keyStats.rows[0];
console.log(`\nrows in table        ${Number(c?.total ?? 0).toLocaleString()}  (live ${Number(c?.live ?? 0).toLocaleString()})`);
console.log(`with barcode         ${Number(c?.withBarcode ?? 0).toLocaleString()}   dropped as invalid length: ${barcodesDropped}`);
console.log(`strict unit binding  ${Number(c?.strict ?? 0).toLocaleString()}`);
console.log(`marked               ${Number(c?.marked ?? 0).toLocaleString()}`);
console.log(`match keys per row   avg ${k?.avgkeys ?? '?'}  max ${k?.maxkeys ?? '?'}`);
console.log(`unit strings unresolved on ${unitsUnresolved.toLocaleString()} rows`);
console.log(`retired this import  ${retired.length.toLocaleString()}`);

await client.end();
