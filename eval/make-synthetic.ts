// Builds eval/synthetic.csv: product names derived from real classifier entries,
// then roughed up the way shops write them. Every row is tagged synthetic.
// Names come from the classifier itself, so these cases OVERESTIMATE accuracy
// on real catalogues; they test robustness to noise, not real-world recall.
// Run: npm run eval:synthetic [-- --count 200 --seed 20261015]
import '../src/lib/load-env.js'; // must precede anything reading process.env
import { writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { matchKeyOf } from '../src/core/normalize/index.js';
import { toCsv } from './csv.js';
import { makeRng, noisify } from './noise.js';

const arg = (flag: string, fallback: number): number => {
  const i = process.argv.indexOf(flag);
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const COUNT = arg('--count', 200);
const SEED = arg('--seed', 20261015);
const PER_GROUP = 3;
const OUT = 'eval/synthetic.csv';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';
const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
const rng = makeRng(SEED);

type Row = {
  code: string; nameUz: string; nameRu: string; groupCode: string;
  unitCanonical: string[]; unitBinding: string; barcode: string | null;
};

// A stable pseudo-random order: same seed, same sample, on any machine.
const { rows } = await pool.query<Row>(
  `SELECT code, "nameUz", "nameRu", "groupCode", "unitCanonical", "unitBinding"::text AS "unitBinding", barcode
   FROM mxik_code
   WHERE "retiredAt" IS NULL AND length("nameUz") BETWEEN 6 AND 70
   ORDER BY md5(code || $1)
   LIMIT 6000`,
  [String(SEED)],
);

/** True when exactly one live code folds to this name, so the label is unambiguous. */
async function unique(name: string): Promise<boolean> {
  const key = matchKeyOf(name);
  if (!key) return false;
  const res = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM mxik_code WHERE "matchKeys" && $1::text[] AND "retiredAt" IS NULL`,
    [[key]],
  );
  return Number(res.rows[0]?.n ?? 0) === 1;
}

const perGroup = new Map<string, number>();
const out: string[][] = [['name', 'unit', 'barcode', 'correct_code', 'source', 'notes']];

for (const row of rows) {
  if (out.length - 1 >= COUNT) break;
  const used = perGroup.get(row.groupCode) ?? 0;
  if (used >= PER_GROUP) continue;

  const russian = rng() < 0.3;
  const base = russian ? row.nameRu : row.nameUz;
  if (!base || !(await unique(base))) continue;

  const { name, applied } = noisify(base, rng);
  const unit = row.unitBinding === 'strict' && row.unitCanonical[0] ? row.unitCanonical[0] : '';
  // Stored as GTIN-14; a catalogue usually carries the 13-digit EAN.
  const barcode = row.barcode && rng() < 0.25 ? row.barcode.trim().replace(/^0(?=\d{13}$)/, '') : '';
  const code = row.code.trim();

  perGroup.set(row.groupCode, used + 1);
  out.push([
    name, unit, barcode, code, 'synthetic',
    `from ${code} (${russian ? 'ru' : 'uz'} name); noise: ${applied.join(', ') || 'none'}${barcode ? '; barcode given' : ''}`,
  ]);
}

writeFileSync(OUT, toCsv(out));
console.log(`wrote ${out.length - 1} synthetic cases from ${perGroup.size} groups -> ${OUT}`);
await pool.end();
