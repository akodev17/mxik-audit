// Loads data/mxik.ndjson into Postgres as a new classifier snapshot. Streams via
// COPY into a temp table, computes the retrieval columns on the way in, then,
// before touching the live table, records what changed against the previous
// import (added, retired, unit binding changed, name changed). A dry run stops
// there and rolls everything back.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { Client } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { indexKeys, matchKeyOf } from '../../src/core/normalize/index.js';
import { resolveUnit } from '../../src/core/normalize/units.js';

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

export type ClassifierDiff = { added: number; retired: number; unitChanged: number; nameChanged: number };

export type LoadResult = {
  /** Null on a dry run, which writes nothing. */
  snapshotId: number | null;
  rows: number;
  previousLive: number;
  diff: ClassifierDiff;
};

export type LoadOptions = {
  databaseUrl: string;
  source: string;
  dryRun?: boolean;
  log?: (line: string) => void;
};

/**
 * The diff against the live table, as SQL over the loaded temp table. Change
 * rows go to classifier_change under the new snapshot; a first import (empty
 * live table) records counts only.
 */
async function recordDiff(client: Client, snapshotId: number | null, firstImport: boolean): Promise<ClassifierDiff> {
  const kinds = {
    added: `SELECT l.code, NULL::jsonb AS before, jsonb_build_object('nameUz', l."nameUz") AS after
            FROM mxik_load l LEFT JOIN mxik_code m ON m.code = l.code AND m."retiredAt" IS NULL
            WHERE m.code IS NULL`,
    retired: `SELECT m.code, jsonb_build_object('nameUz', m."nameUz") AS before, NULL::jsonb AS after
              FROM mxik_code m WHERE m."retiredAt" IS NULL
                AND NOT EXISTS (SELECT 1 FROM mxik_load l WHERE l.code = m.code)`,
    unit_changed: `SELECT m.code,
                     jsonb_build_object('binding', m."unitBinding", 'units', m."unitCanonical") AS before,
                     jsonb_build_object('binding', l."unitBinding", 'units', l."unitCanonical") AS after
                   FROM mxik_code m JOIN mxik_load l ON l.code = m.code
                   WHERE m."retiredAt" IS NULL
                     AND (m."unitBinding" <> l."unitBinding" OR m."unitCanonical" <> l."unitCanonical")`,
    name_changed: `SELECT m.code,
                     jsonb_build_object('nameUz', m."nameUz", 'nameRu', m."nameRu") AS before,
                     jsonb_build_object('nameUz', l."nameUz", 'nameRu', l."nameRu") AS after
                   FROM mxik_code m JOIN mxik_load l ON l.code = m.code
                   WHERE m."retiredAt" IS NULL AND (m."nameUz" <> l."nameUz" OR m."nameRu" <> l."nameRu")`,
  } as const;

  const counts: Record<keyof typeof kinds, number> = { added: 0, retired: 0, unit_changed: 0, name_changed: 0 };
  for (const [kind, query] of Object.entries(kinds) as [keyof typeof kinds, string][]) {
    if (snapshotId !== null && !firstImport) {
      const res = await client.query(
        `INSERT INTO classifier_change ("snapshotId", code, kind, before, after)
         SELECT $1, d.code, $2::classifier_change_kind, d.before, d.after FROM (${query}) d`,
        [snapshotId, kind],
      );
      counts[kind] = res.rowCount ?? 0;
    } else {
      const res = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM (${query}) d`);
      counts[kind] = Number(res.rows[0]?.n ?? 0);
    }
  }
  return { added: counts.added, retired: counts.retired, unitChanged: counts.unit_changed, nameChanged: counts.name_changed };
}

export async function loadClassifier(options: LoadOptions): Promise<LoadResult> {
  const { databaseUrl, source, dryRun = false } = options;
  const log = options.log ?? ((line: string) => console.log(line));
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const prev = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM mxik_code WHERE "retiredAt" IS NULL');
    const previousLive = Number(prev.rows[0]?.n ?? 0);
    log(`existing live codes in db: ${previousLive.toLocaleString()}`);

    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE mxik_load (LIKE mxik_code INCLUDING DEFAULTS) ON COMMIT DROP');
    await client.query('ALTER TABLE mxik_load DROP COLUMN "searchVector"');

    const quoted = COLUMNS.map((c) => `"${c}"`).join(', ');
    const copy = client.query(copyFrom(`COPY mxik_load (${quoted}) FROM STDIN WITH (FORMAT csv)`));

    let rows = 0;
    let barcodesDropped = 0;
    let unitsUnresolved = 0;

    async function* generateCsv(): AsyncGenerator<string> {
      const rl = createInterface({ input: createReadStream(source, 'utf8'), crlfDelay: Infinity });
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
        // Folded, because queries are folded before they hit it. Only the two
        // names: more text diluted trigram similarity (see git history).
        const searchText = [matchKeyOf(nameUz), matchKeyOf(nameRu)].filter(Boolean).join(' ');

        const unitIds = [...new Set(r.unitCanonical.map((u) => resolveUnit(u)?.id).filter((id): id is number => id !== undefined))];
        if (r.unitCanonical.length > 0 && unitIds.length === 0) unitsUnresolved++;

        const barcode = padBarcode(r.barcode);
        if (r.barcode && !barcode) barcodesDropped++;
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
    log(`copied ${rows.toLocaleString()} rows into temp table`);
    await client.query('CREATE INDEX ON mxik_load (code)');
    await client.query('ANALYZE mxik_load');

    const firstImport = previousLive === 0;
    let snapshotId: number | null = null;
    if (!dryRun) {
      const snap = await client.query<{ id: number }>(
        'INSERT INTO catalog_snapshot ("codeCount", source, "retiredCodes") VALUES ($1, $2, $3) RETURNING id',
        [rows, source, []],
      );
      snapshotId = snap.rows[0]?.id ?? null;
    }
    const diff = await recordDiff(client, snapshotId, firstImport);
    log(`diff vs previous: +${diff.added} added, -${diff.retired} retired, ${diff.unitChanged} unit changed, ${diff.nameChanged} name changed`);

    if (dryRun || snapshotId === null) {
      await client.query('ROLLBACK');
      log('dry run: nothing written');
      return { snapshotId: null, rows, previousLive, diff };
    }

    // Upsert into the real table, then retire anything the new import dropped.
    await client.query(`
      INSERT INTO mxik_code (${quoted}, "importedAt")
      SELECT ${quoted}, now() FROM mxik_load
      ON CONFLICT (code) DO UPDATE SET
        ${COLUMNS.filter((c) => c !== 'code').map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')},
        "importedAt" = now(), "retiredAt" = NULL
    `);
    const retired = await client.query<{ code: string }>(`
      UPDATE mxik_code m SET "retiredAt" = now()
      WHERE m."retiredAt" IS NULL AND NOT EXISTS (SELECT 1 FROM mxik_load l WHERE l.code = m.code)
      RETURNING m.code`);
    await client.query(
      `UPDATE catalog_snapshot SET "retiredCodes" = $2, "addedCount" = $3, "retiredCount" = $4,
         "unitChangedCount" = $5, "nameChangedCount" = $6 WHERE id = $1`,
      [snapshotId, retired.rows.map((r) => r.code.trim()), diff.added, diff.retired, diff.unitChanged, diff.nameChanged],
    );
    await client.query('COMMIT');
    await client.query('ANALYZE mxik_code');

    log(`rows loaded ${rows.toLocaleString()} · barcodes dropped (invalid length) ${barcodesDropped} · units unresolved ${unitsUnresolved}`);
    log(`snapshot #${snapshotId} recorded`);
    return { snapshotId, rows, previousLive, diff };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
