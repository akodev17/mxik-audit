// Gate 0 inspector for the official classifier export.
// Layout: row 1 = top header (merged), row 2 = sub header, data from row 3.
// Run: npm run inspect:xlsx [lat|ru|uzcyrl]
import { writeFileSync } from 'node:fs';
import { readRows, readSharedStrings } from './lib/xlsx.js';

const VARIANTS = [
  { key: 'lat', lang: 'uz', file: 'data/classifier_lat.xlsx' },
  { key: 'ru', lang: 'ru', file: 'data/classifier_ru.xlsx' },
  { key: 'uzcyrl', lang: 'uz_cyrl', file: 'data/classifier_uzcyrl.xlsx' },
] as const;

// Fixed column order of the export, verified against the raw sheet XML.
const COL = {
  group: 0, class: 1, position: 2, subPosition: 3, brand: 4, attribute: 5,
  code: 6, name: 7, barcode: 8,
  strictUnitGroup: 9, strictUnit: 10, strictPackages: 11,
  recUnitGroup: 12, recUnit: 13,
  privilegeId: 14,
} as const;

const DISTINCT_CAP = 80_000;
const WIDTH = 15;

type ColStat = {
  top: string; sub: string;
  filled: number; distinct: number; distinctCapped: boolean;
  minLen: number; maxLen: number; samples: string[];
};

async function inspect(file: string) {
  const shared = await readSharedStrings(file);
  const top: string[] = [];
  const sub: string[] = [];
  const cols: ColStat[] = [];
  const seen: Set<string>[] = [];
  for (let i = 0; i < WIDTH; i++) {
    cols.push({ top: '', sub: '', filled: 0, distinct: 0, distinctCapped: false, minLen: Infinity, maxLen: 0, samples: [] });
    seen.push(new Set<string>());
  }

  let dataRows = 0;
  let widestRow = 0;
  const codeLengths = new Map<number, number>();
  const codeSeen = new Set<string>();
  let duplicateCodes = 0;
  let base000 = 0;
  let withBarcode = 0;
  let strict = 0, recommended = 0, both = 0, neither = 0;
  let privilege = 0, packages = 0;
  const strictUnits = new Map<string, number>();
  const recUnits = new Map<string, number>();
  const unitGroups = new Map<string, number>();
  const groupPrefix = new Set<string>();
  const sampleRows: (string | null)[][] = [];
  const multiBarcode = { multi: 0, maxCount: 0 };

  for await (const row of readRows(file, shared)) {
    if (row.index === 1) { row.cells.forEach((c, i) => { if (i < WIDTH) top[i] = c ?? ''; }); continue; }
    if (row.index === 2) { row.cells.forEach((c, i) => { if (i < WIDTH) sub[i] = c ?? ''; }); continue; }

    dataRows++;
    if (row.cells.length > widestRow) widestRow = row.cells.length;
    if (sampleRows.length < 3) sampleRows.push(row.cells.slice(0, WIDTH));

    for (let i = 0; i < WIDTH; i++) {
      const col = cols[i]; const set = seen[i];
      if (!col || !set) continue;
      const v = row.cells[i] ?? null;
      if (v === null) continue;
      col.filled++;
      if (v.length < col.minLen) col.minLen = v.length;
      if (v.length > col.maxLen) col.maxLen = v.length;
      if (set.size < DISTINCT_CAP) set.add(v); else col.distinctCapped = true;
      if (col.samples.length < 3 && !col.samples.includes(v)) col.samples.push(v);
    }

    const code = row.cells[COL.code] ?? null;
    if (code) {
      codeLengths.set(code.length, (codeLengths.get(code.length) ?? 0) + 1);
      if (codeSeen.has(code)) duplicateCodes++; else codeSeen.add(code);
      if (/0{6}$/.test(code)) base000++;
      groupPrefix.add(code.slice(0, 3));
    }
    const bc = row.cells[COL.barcode] ?? null;
    if (bc) {
      withBarcode++;
      const parts = bc.split(/[|,;\s]+/).filter(Boolean);
      if (parts.length > 1) {
        multiBarcode.multi++;
        if (parts.length > multiBarcode.maxCount) multiBarcode.maxCount = parts.length;
      }
    }
    const su = row.cells[COL.strictUnit] ?? null;
    const ru = row.cells[COL.recUnit] ?? null;
    const sg = row.cells[COL.strictUnitGroup] ?? null;
    if (su) { strict++; strictUnits.set(su, (strictUnits.get(su) ?? 0) + 1); }
    if (ru) { recommended++; recUnits.set(ru, (recUnits.get(ru) ?? 0) + 1); }
    if (su && ru) both++;
    if (!su && !ru) neither++;
    if (sg) unitGroups.set(sg, (unitGroups.get(sg) ?? 0) + 1);
    if (row.cells[COL.privilegeId]) privilege++;
    if (row.cells[COL.strictPackages]) packages++;
  }

  cols.forEach((c, i) => {
    c.top = top[i] ?? ''; c.sub = sub[i] ?? '';
    c.distinct = seen[i]?.size ?? 0;
    if (c.minLen === Infinity) c.minLen = 0;
  });

  return {
    file, sharedStrings: shared.length, dataRows, widestRow, cols,
    domain: {
      uniqueCodes: codeSeen.size, duplicateCodes,
      codeLengths: [...codeLengths].sort((a, b) => b[1] - a[1]),
      base000, identifying: codeSeen.size - base000,
      withBarcode, multiBarcode,
      strict, recommended, both, neither, privilege, packages,
      distinctGroupPrefixes: groupPrefix.size,
      distinctStrictUnits: strictUnits.size, distinctRecUnits: recUnits.size,
      distinctUnitGroups: unitGroups.size,
      topStrictUnits: [...strictUnits].sort((a, b) => b[1] - a[1]).slice(0, 10),
      topUnitGroups: [...unitGroups].sort((a, b) => b[1] - a[1]).slice(0, 8),
    },
    sampleRows,
  };
}

const target = process.argv[2];
const chosen = target ? VARIANTS.filter((v) => v.key === target) : VARIANTS;
const report: Record<string, unknown> = {};

for (const v of chosen) {
  const t0 = Date.now();
  const r = await inspect(v.file);
  report[v.key] = { lang: v.lang, ...r };
  console.log(`\n======== ${v.key} (lang=${v.lang})  ${((Date.now() - t0) / 1000).toFixed(1)}s ========`);
  console.log(`sharedStrings=${r.sharedStrings.toLocaleString()}  dataRows=${r.dataRows.toLocaleString()}  widestRow=${r.widestRow}`);
  console.log('\ncol header (row1 / row2)                            filled    fill%  distinct  len      sample');
  r.cols.forEach((c, i) => {
    const letter = String.fromCharCode(65 + i);
    const h = (c.top && c.sub ? `${c.top} / ${c.sub}` : c.top || c.sub || '(blank)').slice(0, 46);
    const pct = ((c.filled / r.dataRows) * 100).toFixed(1).padStart(6);
    const dist = (c.distinctCapped ? `${c.distinct}+` : String(c.distinct)).padStart(8);
    const line = `${letter}   ${h.padEnd(47)} ${String(c.filled).padStart(8)} ${pct}% ${dist}  ${c.minLen}-${c.maxLen}`;
    console.log(line.padEnd(100) + ` ${(c.samples[0] ?? '').slice(0, 32)}`);
  });
  const d = r.domain;
  console.log('\n-- domain --');
  console.log(`unique codes         ${d.uniqueCodes.toLocaleString()}   in-file duplicate rows: ${d.duplicateCodes.toLocaleString()}`);
  console.log(`code lengths         ${d.codeLengths.map(([l, n]) => `${l}ch:${n.toLocaleString()}`).join('  ')}`);
  console.log(`base (last 6 = 0)    ${d.base000.toLocaleString()} (${((d.base000 / d.uniqueCodes) * 100).toFixed(1)}%)   identifying: ${d.identifying.toLocaleString()}`);
  console.log(`with barcode         ${d.withBarcode.toLocaleString()} (${((d.withBarcode / r.dataRows) * 100).toFixed(1)}%)   multi-valued: ${d.multiBarcode.multi.toLocaleString()} (max ${d.multiBarcode.maxCount})`);
  console.log(`STRICT unit          ${d.strict.toLocaleString()} (${((d.strict / r.dataRows) * 100).toFixed(1)}%)   distinct: ${d.distinctStrictUnits}`);
  console.log(`RECOMMENDED unit     ${d.recommended.toLocaleString()} (${((d.recommended / r.dataRows) * 100).toFixed(1)}%)   distinct: ${d.distinctRecUnits}`);
  console.log(`both / neither       ${d.both.toLocaleString()} / ${d.neither.toLocaleString()}`);
  console.log(`packages (col L)     ${d.packages.toLocaleString()}`);
  console.log(`privilege id         ${d.privilege.toLocaleString()}`);
  console.log(`group prefixes       ${d.distinctGroupPrefixes}   unit groups: ${d.distinctUnitGroups}`);
  console.log(`top strict units     ${d.topStrictUnits.map(([u, n]) => `${u}=${n.toLocaleString()}`).join(' | ')}`);
  console.log(`top unit groups      ${d.topUnitGroups.map(([u, n]) => `${u}=${n.toLocaleString()}`).join(' | ')}`);
  console.log('\n-- first data row --');
  r.sampleRows[0]?.forEach((c, i) => {
    const h = (r.cols[i]?.sub || r.cols[i]?.top || '').slice(0, 26);
    console.log(`  ${String.fromCharCode(65 + i)} ${h.padEnd(27)} ${JSON.stringify(c).slice(0, 86)}`);
  });
}

writeFileSync('docs/gate0-xlsx-report.json', JSON.stringify(report, null, 2));
console.log('\nwrote docs/gate0-xlsx-report.json');
