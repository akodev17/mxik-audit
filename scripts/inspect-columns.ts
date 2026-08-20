// Gate 0 deep-dive on the columns whose semantics the brief got wrong:
// the unit columns (J/K/M/N), the code-prefixed hierarchy labels, and base-code coverage.
import { writeFileSync } from 'node:fs';
import { readRows, readSharedStrings } from './lib/xlsx.js';

const FILE = process.argv[2] ?? 'data/classifier_lat.xlsx';
const COL = { group: 0, subPosition: 3, brand: 4, attribute: 5, code: 6, name: 7, barcode: 8, strictGroup: 9, strictUnit: 10, packages: 11, recGroup: 12, recUnit: 13, privilege: 14 } as const;

const shared = await readSharedStrings(FILE);

const groupNames = new Map<string, number>();
const strictGroupVals = new Map<string, number>();
const strictUnitVals = new Map<string, number>();
const recGroupVals = new Map<string, number>();
const recUnitVals = new Map<string, number>();
const packageSamples: string[] = [];
const privilegeVals = new Map<string, number>();

// Separator census: does a cell hold a list rather than a scalar?
const sepCounts = { comma: 0, semicolon: 0, pipe: 0, slash: 0, newline: 0, star: 0 };

const subPositions = new Set<string>();
const subPositionsWithBase = new Set<string>();
const barcodeLengths = new Map<number, number>();
let rows = 0;
let hierarchyPrefixMismatch = 0;
const mismatchSamples: string[] = [];
let attributeDash = 0;
let brandDash = 0;

for await (const row of readRows(FILE, shared)) {
  if (row.index <= 2) continue;
  rows++;
  const c = row.cells;
  const code = c[COL.code] ?? '';
  const g = (c[COL.group] ?? '').trim();
  if (g) groupNames.set(g, (groupNames.get(g) ?? 0) + 1);

  for (const [key, col] of [['strictGroup', COL.strictGroup], ['strictUnit', COL.strictUnit], ['recGroup', COL.recGroup], ['recUnit', COL.recUnit]] as const) {
    const v = (c[col] ?? '').trim();
    if (!v) continue;
    const target = key === 'strictGroup' ? strictGroupVals : key === 'strictUnit' ? strictUnitVals : key === 'recGroup' ? recGroupVals : recUnitVals;
    target.set(v, (target.get(v) ?? 0) + 1);
    if (v.includes(',')) sepCounts.comma++;
    if (v.includes(';')) sepCounts.semicolon++;
    if (v.includes('|')) sepCounts.pipe++;
    if (v.includes('/')) sepCounts.slash++;
    if (v.includes('\n')) sepCounts.newline++;
    if (v.includes('*')) sepCounts.star++;
  }

  const pk = c[COL.packages];
  if (pk && packageSamples.length < 12) packageSamples.push(pk);
  const pv = (c[COL.privilege] ?? '').trim();
  if (pv) privilegeVals.set(pv, (privilegeVals.get(pv) ?? 0) + 1);

  if (code.length === 17) {
    const sub = code.slice(0, 11);
    subPositions.add(sub);
    if (code.slice(11) === '000000') subPositionsWithBase.add(sub);
    // Hierarchy label cells are "code-name"; verify the embedded code matches.
    const subLabel = c[COL.subPosition] ?? '';
    const embedded = subLabel.split('-')[0] ?? '';
    if (embedded !== sub) {
      hierarchyPrefixMismatch++;
      if (mismatchSamples.length < 5) mismatchSamples.push(`${code} | ${subLabel.slice(0, 60)}`);
    }
  }
  const bc = c[COL.barcode];
  if (bc) barcodeLengths.set(bc.length, (barcodeLengths.get(bc.length) ?? 0) + 1);
  if ((c[COL.attribute] ?? '').trim() === '---') attributeDash++;
  if ((c[COL.brand] ?? '').endsWith('---')) brandDash++;
}

const show = (label: string, m: Map<string, number>, n = 30) => {
  console.log(`\n--- ${label}: ${m.size} distinct ---`);
  [...m].sort((a, b) => b[1] - a[1]).slice(0, n)
    .forEach(([v, k]) => console.log(`${String(k).padStart(8)}  ${JSON.stringify(v).slice(0, 100)}`));
};

console.log(`file=${FILE}  dataRows=${rows.toLocaleString()}`);
console.log(`\nsubPositions=${subPositions.size.toLocaleString()}  withBaseCode=${subPositionsWithBase.size.toLocaleString()} (${((subPositionsWithBase.size / subPositions.size) * 100).toFixed(1)}%)`);
console.log(`hierarchy label/code mismatches: ${hierarchyPrefixMismatch.toLocaleString()}`);
mismatchSamples.forEach((s) => console.log(`   ${s}`));
console.log(`attribute === '---': ${attributeDash.toLocaleString()}   brand ends '---': ${brandDash.toLocaleString()}`);
console.log(`barcode lengths: ${[...barcodeLengths].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l}ch:${n.toLocaleString()}`).join('  ')}`);
console.log(`separator census inside unit cells: ${JSON.stringify(sepCounts)}`);

show('J strict unit GROUP', strictGroupVals, 40);
show('K strict UNIT', strictUnitVals, 20);
show('M recommended unit GROUP', recGroupVals, 25);
show('N recommended UNIT', recUnitVals, 25);
show('O privilege id', privilegeVals, 12);
show('A group name', groupNames, 8);

console.log('\n--- L packages samples ---');
packageSamples.forEach((s) => console.log(`   ${JSON.stringify(s).slice(0, 130)}`));

writeFileSync('docs/gate0-columns.json', JSON.stringify({
  file: FILE, rows,
  subPositions: subPositions.size, subPositionsWithBase: subPositionsWithBase.size,
  hierarchyPrefixMismatch, sepCounts,
  strictGroup: [...strictGroupVals].sort((a, b) => b[1] - a[1]),
  strictUnit: [...strictUnitVals].sort((a, b) => b[1] - a[1]),
  recGroup: [...recGroupVals].sort((a, b) => b[1] - a[1]),
  recUnit: [...recUnitVals].sort((a, b) => b[1] - a[1]),
  groupNames: [...groupNames].sort((a, b) => b[1] - a[1]),
  privilegeVals: [...privilegeVals].sort((a, b) => b[1] - a[1]),
  packageSamples,
}, null, 2));
console.log('\nwrote docs/gate0-columns.json');
