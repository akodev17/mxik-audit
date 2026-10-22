// Builds prisma/demo-catalog.json, the fixture behind demo mode. Dev tool: it
// needs the classifier loaded. Product lines are invented (scripts/demo/
// products.ts); each one's code is the hand-checked pin in CODES, or the
// search's top-1 where none is pinned, and resolved.txt records which was used
// so a human can check it.
// Run: npm run make:demo-catalog
import '@tasnivo/domain/load-env';
import { writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { HashingEmbeddingProvider } from '@tasnivo/core/embed/index';
import { matchProduct } from '@tasnivo/core/match/pipeline';
import { NoopRerankProvider } from '@tasnivo/core/match/rerank';
import { hierarchyPath } from '@tasnivo/core/match/rules';
import { PostgresCandidateStore } from '@tasnivo/core/match/store';
import { checkVectorReadiness } from '@tasnivo/core/match/vector-readiness';
import { unitsCompatible } from '@tasnivo/core/normalize/units';
import type { MxikCandidate } from '@tasnivo/core/match/types';
import { makeRng } from '../eval/noise.js';
import { CODES as OVERRIDES, PRODUCTS } from './demo/products.js';
import { SAMPLE_HEADERS, SAMPLE_MAPPING, SAMPLE_ROWS } from './landing-sample/catalog.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';
const pool = new Pool({ connectionString: DATABASE_URL, max: 6 });
const readiness = await checkVectorReadiness(pool, new HashingEmbeddingProvider());
const store = new PostgresCandidateStore(pool, { exactVectorScan: true, vectorEnabled: readiness.usable });
const rng = makeRng(20261015);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;

// ------------------------------------------------------------- resolve
type Resolved = { name: string; unit: string; query: string; code: MxikCandidate };
const resolved: Resolved[] = [];
const review: string[] = [];
for (const p of PRODUCTS) {
  const override = OVERRIDES[p.query];
  const result = override
    ? { candidates: [] as { candidate: MxikCandidate; confidence: number }[] }
    : await matchProduct({ rawName: p.query }, { store, embedder: readiness.embedder, reranker: new NoopRerankProvider() });
  const code = override ? await store.byCode(override) : result.candidates[0]?.candidate ?? null;
  if (!code) {
    review.push(`!! no code for ${p.query}`);
    continue;
  }
  resolved.push({ ...p, code });
  review.push(`${p.name}\n   query  ${p.query}\n   code   ${code.code}  ${code.nameUz.slice(0, 80)}\n   path   ${hierarchyPath(code).slice(0, 110)}`
    + `${result.candidates.slice(1, 3).map((c) => `\n   alt    ${c.candidate.code}  ${c.candidate.nameUz.slice(0, 70)}`).join('')}`);
}
writeFileSync('scripts/demo/resolved.txt', review.join('\n\n') + '\n');

// --------------------------------------------------------- barcoded rows
const { rows: barcoded } = await pool.query<{ code: string; nameUz: string; barcode: string; unitCanonical: string[] }>(
  `SELECT code, "nameUz", barcode, "unitCanonical" FROM mxik_code
   WHERE barcode IS NOT NULL AND "retiredAt" IS NULL AND "groupCode" IN ('022', '019', '034', '017', '020', '018')
     -- Drinks, but not alcohol (positions 02203-02208).
     AND left(code, 5) NOT IN ('02203', '02204', '02205', '02206', '02207', '02208')
     AND length("nameUz") BETWEEN 20 AND 90
   ORDER BY md5(code || 'demo') LIMIT 20`,
);

// ------------------------------------------------------------ assemble
const WRONG_UNITS = ['kg', 'litr', 'dona', 'metr', 'tonna', 'шт', 'кг', 'упак'];
/** Another pack size of the same kind, for a second line of the same product. */
const PACKS = {
  mass: ['5 kg', '10 kg', '2 kg', '250 gr', '1 кг', '3 кг'],
  volume: ['0,5 l', '1,5 L', '5 л', '0,25 л', '3 l'],
};
// No \b: it is ASCII-only in JavaScript and misses Cyrillic units.
const PACK_RE = /\s+\d[\d.,]*\s*(kg|кг|gr|g|г|ml|мл|l|L|л)(?=$|[\s,.)%])(.*)$/u;

/** The product with its pack size swapped, or null when it has none. */
function packVariant(name: string): string | null {
  const m = PACK_RE.exec(name);
  if (!m) return null;
  const unit = (m[1] ?? '').toLowerCase();
  const kind = ['kg', 'кг', 'gr', 'g', 'г'].includes(unit) ? 'mass' : 'volume';
  return `${name.slice(0, m.index)} ${pick(PACKS[kind])}`;
}

/** Units a shop actually writes, most likely first. */
const SHOP_UNITS = ['dona', 'kilogramm', 'litr', 'metr', 'kv. metr', 'kub. metr', 'xizmat', 'gramm', 'millilitr'];

/** The strictly bound unit a shop would most plausibly write, or null when unbound. */
const strictUnit = (c: MxikCandidate): string | null => {
  if (c.unitBinding !== 'strict' || c.unitCanonical.length === 0) return null;
  return SHOP_UNITS.find((u) => c.unitCanonical.includes(u)) ?? c.unitCanonical[0] ?? null;
};

function deadCode(code: string): string {
  // Either a code that was never issued (wrong tail) or a digit short, as when
  // a spreadsheet stripped a leading zero.
  return rng() < 0.5 ? `${code.slice(0, 14)}999` : code.replace(/^0/, '');
}

/** What a row was built to be, so the audit's findings can be scored against it. */
type Intent = 'clean' | 'missing' | 'not_found' | 'wrong_code' | 'unit_conflict';
type Row = { name: string; unit: string; code: string; barcode: string; intent: Intent; correctCode: string };
const rows: Row[] = [];

function addRow(r: Resolved, name: string): void {
  const roll = rng();
  const own = strictUnit(r.code);
  const correctCode = r.code.code;
  // A clean row's unit agrees with the code; otherwise keep what the company wrote.
  const cleanUnit = own && !unitsCompatible(r.unit, r.code.unitCanonical) ? own : r.unit;
  const base = { name, barcode: '', correctCode };
  if (roll < 0.18) {
    rows.push({ ...base, unit: r.unit, code: '', intent: 'missing' });
  } else if (roll < 0.27) {
    rows.push({ ...base, unit: cleanUnit, code: deadCode(correctCode), intent: 'not_found' });
  } else if (roll < 0.40) {
    const other = pick(resolved.filter((x) => x.code.code.slice(0, 3) !== correctCode.slice(0, 3)));
    rows.push({ ...base, unit: cleanUnit, code: other.code.code, intent: 'wrong_code' });
  } else if (roll < 0.50 && own) {
    const wrong = WRONG_UNITS.filter((u) => !unitsCompatible(u, r.code.unitCanonical));
    rows.push({ ...base, unit: pick(wrong), code: correctCode, intent: 'unit_conflict' });
  } else {
    rows.push({ ...base, unit: cleanUnit, code: correctCode, intent: 'clean' });
  }
}

for (const r of resolved) addRow(r, r.name);
for (const r of resolved) {
  const variant = packVariant(r.name);
  if (variant && rng() < 0.9) addRow(r, variant);
}
for (const b of barcoded) {
  // Shop-style: the product part of the classifier name, the EAN-13 alongside.
  const name = (b.nameUz.split(':')[1] ?? b.nameUz).replace(/\s+/g, ' ').trim().slice(0, 60);
  const withCode = rng() >= 0.5;
  rows.push({
    name, unit: b.unitCanonical[0] ?? 'dona', code: withCode ? b.code.trim() : '',
    barcode: b.barcode.trim().replace(/^0(?=\d{13}$)/, ''),
    intent: withCode ? 'clean' : 'missing', correctCode: b.code.trim(),
  });
}

// Shuffle so failure modes are not clustered, then number the rows.
for (let i = rows.length - 1; i > 0; i--) {
  const j = Math.floor(rng() * (i + 1));
  [rows[i], rows[j]] = [rows[j] as Row, rows[i] as Row];
}

// The landing page's sample rows come first, verbatim, so every row a visitor
// saw on the landing page is in the demo with the same result. Same 1C-style
// header layout as that sample: name, barcode, code, unit, price.
const cells: string[][] = [
  ...SAMPLE_ROWS.map((r) => [...r]),
  ...rows.map((r) => [r.name, r.barcode, r.code, r.unit, String((Math.floor(rng() * 200) + 1) * 500)]),
];

writeFileSync('packages/db/prisma/demo-catalog.json', JSON.stringify({
  note: 'Invented demo catalogue for demo mode. Built by `npm run make:demo-catalog`: the landing sample (scripts/landing-sample/catalog.ts) followed by the product lines in scripts/demo/products.ts. No real company data.',
  filename: 'Demo_Savdo_1C_eksport.xlsx',
  headers: [...SAMPLE_HEADERS],
  columnMap: SAMPLE_MAPPING,
  rows: cells,
  // Ground truth per row (null for the landing sample's rows), for
  // `npm run demo:quality`. Never part of the uploaded file.
  labels: [
    ...SAMPLE_ROWS.map(() => null),
    ...rows.map((r) => ({ intent: r.intent, correctCode: r.correctCode })),
  ],
}, null, 2) + '\n');

console.log(`resolved ${resolved.length}/${PRODUCTS.length} product lines -> scripts/demo/resolved.txt`);
console.log(`wrote ${cells.length} rows -> packages/db/prisma/demo-catalog.json`);
await pool.end();
