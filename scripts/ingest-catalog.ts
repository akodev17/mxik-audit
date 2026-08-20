// Normalizes the three language exports into one NDJSON table, one record per
// MXIK code. Excel is the primary source; the API is used only for the reference
// unit dictionary and (optionally) the marking flag, which the export omits.
//
//   npm run ingest                 Excel only
//   npm run ingest -- --enrich     also fetch `label` (marking flag) per code, ~10 min
//   npm run ingest -- --source=api explicit API tree-walk fallback (slow, last resort)
import { createWriteStream, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { readRows, readSharedStrings } from './lib/xlsx.js';

const BASE = 'https://tasnif.soliq.uz/api/cls-api';
const OUT = 'data/mxik.ndjson';

const FILES = {
  uz: 'data/classifier_lat.xlsx',
  ru: 'data/classifier_ru.xlsx',
  uzCyrl: 'data/classifier_uzcyrl.xlsx',
} as const;

const C = {
  group: 0, class: 1, position: 2, subPosition: 3, brand: 4, attribute: 5,
  code: 6, name: 7, barcode: 8,
  strictUnit: 9, strictUnitAlt: 10, packages: 11,
  recUnitGroup: 12, recUnit: 13, privilege: 14,
} as const;

const args = new Set(process.argv.slice(2));
const ENRICH = args.has('--enrich');
const SOURCE_API = [...args].some((a) => a === '--source=api');

// ---------------------------------------------------------------- normalization
/** All seven apostrophe-like marks found in the export collapse to U+02BB. */
const APOSTROPHES = /[‘’ʼ`´′']/g;
export function foldApostrophes(s: string): string {
  return s.replace(APOSTROPHES, 'ʻ');
}

/** Strips the "CODE-" / "CODE " prefix the export prepends to hierarchy labels. */
export function stripCodePrefix(label: string | null): string | null {
  if (!label) return null;
  const out = label.replace(/^\d+[-\s]+/, '').trim();
  return out === '' || out === '---' || out === '--' ? null : out;
}

export type ParsedUnit = {
  raw: string;
  /** Acceptable canonical units. Usually one; column J sometimes lists several. */
  canonical: string[];
  container: string | null;
  quantity: number | null;
  quantityUnit: string | null;
};

/** Spelling drift inside the official export itself. */
const UNIT_ALIASES: Record<string, string> = {
  'kv.metr': 'kv. metr',
  'kub.metr': 'kub. metr',
  'sht.': 'dona',
  sht: 'dona',
  'шт.': 'dona',
  дона: 'dona',
};

function canonicalizeUnit(s: string): string {
  const v = foldApostrophes(s).replace(/\s+/g, ' ').trim().toLowerCase();
  return UNIT_ALIASES[v] ?? v;
}

/**
 * Column J fuses the bound unit with packaging detail, e.g.
 * "dona (pэt butilka)  0.75 litr", and sometimes carries a comma-separated list
 * of acceptable units instead of a single one.
 */
export function parseUnit(raw: string | null): ParsedUnit | null {
  if (!raw) return null;
  const clean = foldApostrophes(raw).replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const paren = clean.indexOf('(');
  const head = (paren === -1 ? clean : clean.slice(0, paren)).trim();
  let container: string | null = null;
  let quantity: number | null = null;
  let quantityUnit: string | null = null;
  if (paren !== -1) {
    // Balance nested parens: "dona (tabletka (10 mg))".
    let depth = 0; let end = -1;
    for (let i = paren; i < clean.length; i++) {
      if (clean[i] === '(') depth++;
      else if (clean[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end !== -1) {
      container = clean.slice(paren + 1, end).trim() || null;
      const tail = clean.slice(end + 1).trim();
      const m = /^([\d]+(?:[.,]\d+)?)\s*(.+)$/.exec(tail);
      if (m?.[1] && m[2]) { quantity = Number(m[1].replace(',', '.')); quantityUnit = m[2].trim(); }
    }
  }
  // A value like "(iste'mol qutisi)" has no head; fall back to the container.
  const source = head || container || '';
  const canonical = source.split(',').map(canonicalizeUnit).filter(Boolean);
  if (!canonical.length) return null;
  return { raw, canonical, container, quantity, quantityUnit };
}

/** Comma-separated multi-value cells (recommended units / unit groups). */
export function splitList(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => foldApostrophes(s).trim()).filter(Boolean);
}

export type MxikRecord = {
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
  unitQuantityUnit: string | null;
  unitBinding: 'strict' | 'recommended' | 'none';
  recommendedUnits: string[];
  recommendedUnitGroups: string[];
  packagesRaw: string | null;
  taxPrivilegeIds: string[];
  isBase: boolean;
  isMarked: boolean | null; // null unless --enrich ran
};

// ---------------------------------------------------------------- language passes
type PerCode = { name: string | null; attribute: string | null; brand: string | null };
type Hierarchy = Map<string, string | null>;

async function readLanguage(file: string) {
  const shared = await readSharedStrings(file);
  const perCode = new Map<string, PerCode>();
  const groups: Hierarchy = new Map();
  const classes: Hierarchy = new Map();
  const positions: Hierarchy = new Map();
  const subPositions: Hierarchy = new Map();
  for await (const row of readRows(file, shared)) {
    if (row.index <= 2) continue;
    const code = row.cells[C.code];
    if (!code || code.length !== 17) continue;
    perCode.set(code, {
      name: row.cells[C.name] ?? null,
      attribute: stripCodePrefix(row.cells[C.attribute] ?? null),
      brand: stripCodePrefix(row.cells[C.brand] ?? null),
    });
    const g = code.slice(0, 3), cl = code.slice(0, 5), p = code.slice(0, 8), s = code.slice(0, 11);
    if (!groups.has(g)) groups.set(g, stripCodePrefix(row.cells[C.group] ?? null));
    if (!classes.has(cl)) classes.set(cl, stripCodePrefix(row.cells[C.class] ?? null));
    if (!positions.has(p)) positions.set(p, stripCodePrefix(row.cells[C.position] ?? null));
    if (!subPositions.has(s)) subPositions.set(s, stripCodePrefix(row.cells[C.subPosition] ?? null));
  }
  return { perCode, groups, classes, positions, subPositions };
}

// ---------------------------------------------------------------- enrichment
async function fetchMarkingFlags(codes: string[], concurrency = 25): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  let next = 0;
  let done = 0;
  const started = Date.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const i = next++;
      const code = codes[i];
      if (code === undefined) return;
      try {
        const res = await fetch(`${BASE}/mxik/search/by-params?mxikCode=${code}&size=1&page=0&lang=uz`);
        const j = (await res.json()) as { data?: { content?: Record<string, unknown>[] } };
        const label = j.data?.content?.[0]?.['label'];
        if (typeof label === 'string' || typeof label === 'number') out.set(code, String(label) === '1');
      } catch { /* leave unset; reported as coverage gap */ }
      if (++done % 20_000 === 0) {
        const rate = done / ((Date.now() - started) / 1000);
        process.stderr.write(`  enriched ${done.toLocaleString()}/${codes.length.toLocaleString()} (${rate.toFixed(0)}/s)\n`);
      }
    }
  }));
  return out;
}

/** Explicit fallback: walk the portal hierarchy to leaf codes. Slow; Excel is preferred. */
async function apiTreeWalk(): Promise<string[]> {
  const leaves: string[] = [];
  const level = async (path: string, param: string, value: string): Promise<string[]> => {
    const res = await fetch(`${BASE}/${path}?${param}=${value}&size=200&page=0&lang=uz`);
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: unknown };
    return Array.isArray(j.data)
      ? j.data.map((d) => (d as Record<string, unknown>)['code']).filter((c): c is string => typeof c === 'string')
      : [];
  };
  const groupsRes = await fetch(`${BASE}/group?lang=uz&size=200&page=0`);
  const gj = (await groupsRes.json()) as { data?: unknown };
  const groups = Array.isArray(gj.data)
    ? gj.data.map((d) => (d as Record<string, unknown>)['code']).filter((c): c is string => typeof c === 'string')
    : [];
  for (const g of groups) {
    for (const cl of await level('class/short-info', 'groupCode', g)) {
      for (const p of await level('position/short-info', 'classCode', cl)) {
        for (const s of await level('subposition/short-info', 'positionCode', p)) {
          for (const b of await level('brand/short-info', 'subPositionCode', s)) {
            leaves.push(...await level('attribute/by-brand', 'brandCode', b));
          }
        }
      }
    }
  }
  return leaves;
}

// ---------------------------------------------------------------- main
if (SOURCE_API) {
  console.error('--source=api requested: walking the portal hierarchy (slow fallback).');
  const leaves = await apiTreeWalk();
  writeFileSync('data/api-tree-codes.json', JSON.stringify({ count: leaves.length, codes: leaves }, null, 2));
  console.log(`API tree walk produced ${leaves.length.toLocaleString()} codes -> data/api-tree-codes.json`);
  process.exit(0);
}

console.error('pass 1/3  reading ru ...');
const ru = await readLanguage(FILES.ru);
console.error('pass 2/3  reading uz_cyrl ...');
const cyrl = await readLanguage(FILES.uzCyrl);
console.error('pass 3/3  streaming uz (latin) and emitting ...');

// Reference unit dictionary straight from the portal, so we never invent one.
let apiUnits: { id: number; name: string }[] = [];
try {
  const res = await fetch(`${BASE}/integration-mxik/references/get/units/all?pageSize=500`);
  const j = (await res.json()) as { data?: unknown };
  if (Array.isArray(j.data)) {
    apiUnits = j.data.flatMap((d) => {
      const r = d as Record<string, unknown>;
      return typeof r['id'] === 'number' && typeof r['name'] === 'string' ? [{ id: r['id'], name: r['name'] }] : [];
    });
  }
} catch { console.error('warning: unit reference fetch failed; continuing without it'); }

let markingFlags = new Map<string, boolean>();
if (ENRICH) {
  console.error('enrichment: fetching marking flags for all codes ...');
  markingFlags = await fetchMarkingFlags([...ru.perCode.keys()]);
  console.error(`  marking flags resolved for ${markingFlags.size.toLocaleString()} codes`);
}

const out = createWriteStream(OUT, { encoding: 'utf8' });
const shared = await readSharedStrings(FILES.uz);

const canonicalUnits = new Map<string, number>();
const containers = new Map<string, number>();
const stats = {
  emitted: 0, missingRu: 0, missingCyrl: 0,
  strict: 0, recommendedOnly: 0, none: 0,
  base: 0, barcode: 0, privilege: 0, marked: 0, markedUnknown: 0,
};

for await (const row of readRows(FILES.uz, shared)) {
  if (row.index <= 2) continue;
  const code = row.cells[C.code];
  if (!code || code.length !== 17) continue;

  const r = ru.perCode.get(code);
  const c = cyrl.perCode.get(code);
  if (!r) stats.missingRu++;
  if (!c) stats.missingCyrl++;

  const unitRaw = row.cells[C.strictUnit] ?? null;
  const parsed = parseUnit(unitRaw);
  const recUnits = splitList(row.cells[C.recUnit] ?? null);
  const recGroups = splitList(row.cells[C.recUnitGroup] ?? null);
  const binding: MxikRecord['unitBinding'] = parsed ? 'strict' : (recUnits.length ? 'recommended' : 'none');
  if (binding === 'strict') stats.strict++;
  else if (binding === 'recommended') stats.recommendedOnly++;
  else stats.none++;
  if (parsed) {
    for (const u of parsed.canonical) canonicalUnits.set(u, (canonicalUnits.get(u) ?? 0) + 1);
    if (parsed.container) containers.set(parsed.container, (containers.get(parsed.container) ?? 0) + 1);
  }

  const g = code.slice(0, 3), cl = code.slice(0, 5), p = code.slice(0, 8), s = code.slice(0, 11), b = code.slice(0, 14);
  const isBase = code.slice(11) === '000000';
  if (isBase) stats.base++;
  const barcode = row.cells[C.barcode] ?? null;
  if (barcode) stats.barcode++;
  const privileges = splitList(row.cells[C.privilege] ?? null);
  if (privileges.length) stats.privilege++;
  // ?? null would collapse a genuine `false` into "unknown", so branch on has().
  const marked = markingFlags.get(code) ?? (markingFlags.has(code) ? false : null);
  if (marked === true) stats.marked++;
  if (ENRICH && marked === null) stats.markedUnknown++;

  const rec: MxikRecord = {
    code,
    groupCode: g, classCode: cl, positionCode: p, subPositionCode: s, brandCode: b,
    nameUz: row.cells[C.name] ?? null, nameRu: r?.name ?? null, nameUzCyrl: c?.name ?? null,
    groupNameUz: stripCodePrefix(row.cells[C.group] ?? null),
    groupNameRu: ru.groups.get(g) ?? null, groupNameUzCyrl: cyrl.groups.get(g) ?? null,
    classNameUz: stripCodePrefix(row.cells[C.class] ?? null),
    classNameRu: ru.classes.get(cl) ?? null, classNameUzCyrl: cyrl.classes.get(cl) ?? null,
    positionNameUz: stripCodePrefix(row.cells[C.position] ?? null),
    positionNameRu: ru.positions.get(p) ?? null, positionNameUzCyrl: cyrl.positions.get(p) ?? null,
    subPositionNameUz: stripCodePrefix(row.cells[C.subPosition] ?? null),
    subPositionNameRu: ru.subPositions.get(s) ?? null, subPositionNameUzCyrl: cyrl.subPositions.get(s) ?? null,
    brandNameUz: stripCodePrefix(row.cells[C.brand] ?? null),
    brandNameRu: r?.brand ?? null, brandNameUzCyrl: c?.brand ?? null,
    attributeNameUz: stripCodePrefix(row.cells[C.attribute] ?? null),
    attributeNameRu: r?.attribute ?? null, attributeNameUzCyrl: c?.attribute ?? null,
    barcode,
    unitRaw,
    unitCanonical: parsed?.canonical ?? [],
    unitContainer: parsed?.container ?? null,
    unitQuantity: parsed?.quantity ?? null,
    unitQuantityUnit: parsed?.quantityUnit ?? null,
    unitBinding: binding,
    recommendedUnits: recUnits,
    recommendedUnitGroups: recGroups,
    packagesRaw: row.cells[C.packages] ?? null,
    taxPrivilegeIds: privileges,
    isBase,
    isMarked: marked,
  };

  stats.emitted++;
  if (!out.write(JSON.stringify(rec) + '\n')) await once(out, 'drain');
}

out.end();
await once(out, 'finish');

const unitList = [...canonicalUnits].sort((a, b) => b[1] - a[1]);
writeFileSync('data/units.json', JSON.stringify({
  apiReference: apiUnits,
  canonicalFromExport: unitList,
  containersFromExport: [...containers].sort((a, b) => b[1] - a[1]),
}, null, 2));

const manifest = {
  generatedAt: new Date().toISOString(),
  source: 'excel',
  files: FILES,
  enriched: ENRICH,
  ...stats,
  distinctCanonicalUnits: canonicalUnits.size,
  distinctContainers: containers.size,
  apiReferenceUnits: apiUnits.length,
};
writeFileSync('data/ingest-manifest.json', JSON.stringify(manifest, null, 2));

console.log(`\nemitted            ${stats.emitted.toLocaleString()} records -> ${OUT}`);
console.log(`missing ru / cyrl  ${stats.missingRu} / ${stats.missingCyrl}`);
console.log(`unitBinding        strict=${stats.strict.toLocaleString()}  recommendedOnly=${stats.recommendedOnly.toLocaleString()}  none=${stats.none.toLocaleString()}`);
console.log(`base codes         ${stats.base.toLocaleString()}`);
console.log(`barcodes           ${stats.barcode.toLocaleString()}`);
console.log(`privilege rows     ${stats.privilege.toLocaleString()}`);
console.log(`marked             ${ENRICH ? `${stats.marked.toLocaleString()} (unresolved ${stats.markedUnknown.toLocaleString()})` : 'not enriched (isMarked=null)'}`);
console.log(`\ncanonical units    ${canonicalUnits.size} distinct (from ${unitList.reduce((s, [, n]) => s + n, 0).toLocaleString()} rows)`);
console.log(unitList.slice(0, 25).map(([u, n]) => `   ${String(n).padStart(7)}  ${u}`).join('\n'));
console.log(`\ncontainers         ${containers.size} distinct`);
console.log(`api unit reference ${apiUnits.length} entries -> data/units.json`);
console.log(`manifest           data/ingest-manifest.json`);
