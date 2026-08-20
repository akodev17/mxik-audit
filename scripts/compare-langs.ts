// Gate 0: joins the three language exports on mxikCode to establish which name
// variants actually exist per code, and how dirty each variant is.
// Run: tsx scripts/compare-langs.ts
import { writeFileSync } from 'node:fs';
import { readRows, readSharedStrings } from './lib/xlsx.js';

const FILES = {
  lat: 'data/classifier_lat.xlsx',
  ru: 'data/classifier_ru.xlsx',
  uzcyrl: 'data/classifier_uzcyrl.xlsx',
} as const;
type Variant = keyof typeof FILES;
const CODE = 6, NAME = 7, STRICT = 9;

const CYR = /[Ѐ-ӿԀ-ԯ]/;
const LAT = /[A-Za-z]/;
// Apostrophe-like marks that all stand for the same Uzbek modifier letter.
const APOS = { u02BB: 'ʻ', u02BC: 'ʼ', u2018: '‘', u2019: '’', ascii: "'", backtick: '`', acute: '´' } as const;

function classify(s: string): 'cyrillic' | 'latin' | 'mixed' | 'neither' {
  const c = CYR.test(s), l = LAT.test(s);
  if (c && l) return 'mixed';
  if (c) return 'cyrillic';
  if (l) return 'latin';
  return 'neither';
}

type Stats = {
  rows: number;
  scripts: Record<string, number>;
  apostrophes: Record<string, number>;
  emptyName: number;
  strictScripts: Record<string, number>;
  sampleMixed: string[];
};

const names: Record<Variant, Map<string, string>> = { lat: new Map(), ru: new Map(), uzcyrl: new Map() };
const stats: Record<string, Stats> = {};

for (const [key, file] of Object.entries(FILES) as [Variant, string][]) {
  const shared = await readSharedStrings(file);
  const st: Stats = { rows: 0, scripts: {}, apostrophes: {}, emptyName: 0, strictScripts: {}, sampleMixed: [] };
  for await (const row of readRows(file, shared)) {
    if (row.index <= 2) continue;
    const code = row.cells[CODE];
    if (!code) continue;
    st.rows++;
    const name = row.cells[NAME] ?? '';
    names[key].set(code, name);
    if (!name) st.emptyName++;
    const cls = classify(name);
    st.scripts[cls] = (st.scripts[cls] ?? 0) + 1;
    if (cls === 'mixed' && st.sampleMixed.length < 6) st.sampleMixed.push(name.slice(0, 80));
    for (const [an, ch] of Object.entries(APOS)) {
      if (name.includes(ch)) st.apostrophes[an] = (st.apostrophes[an] ?? 0) + 1;
    }
    const su = row.cells[STRICT];
    if (su) { const sc = classify(su); st.strictScripts[sc] = (st.strictScripts[sc] ?? 0) + 1; }
  }
  stats[key] = st;
  console.log(`\n=== ${key} (${file}) ===`);
  console.log(`rows=${st.rows.toLocaleString()}  emptyName=${st.emptyName}`);
  console.log(`name script:   ${JSON.stringify(st.scripts)}`);
  console.log(`unit script:   ${JSON.stringify(st.strictScripts)}`);
  console.log(`apostrophes:   ${JSON.stringify(st.apostrophes)}`);
  st.sampleMixed.forEach((s) => console.log(`   mixed: ${s}`));
}

// Cross-variant join
const all = new Set<string>([...names.lat.keys(), ...names.ru.keys(), ...names.uzcyrl.keys()]);
let inAll3 = 0, missingLat = 0, missingRu = 0, missingCyrl = 0;
let latEqCyrl = 0, latEqRu = 0, ruEqCyrl = 0, allDistinct = 0;
const missingSamples: string[] = [];
for (const code of all) {
  const l = names.lat.get(code), r = names.ru.get(code), c = names.uzcyrl.get(code);
  if (l !== undefined && r !== undefined && c !== undefined) inAll3++;
  if (l === undefined) { missingLat++; if (missingSamples.length < 5) missingSamples.push(`${code} missing lat`); }
  if (r === undefined) { missingRu++; if (missingSamples.length < 5) missingSamples.push(`${code} missing ru`); }
  if (c === undefined) { missingCyrl++; if (missingSamples.length < 5) missingSamples.push(`${code} missing cyrl`); }
  if (l && c && l === c) latEqCyrl++;
  if (l && r && l === r) latEqRu++;
  if (r && c && r === c) ruEqCyrl++;
  if (l && r && c && l !== r && l !== c && r !== c) allDistinct++;
}

console.log(`\n=== cross-variant join ===`);
console.log(`union of codes:        ${all.size.toLocaleString()}`);
console.log(`present in all three:  ${inAll3.toLocaleString()}`);
console.log(`missing lat/ru/cyrl:   ${missingLat} / ${missingRu} / ${missingCyrl}`);
missingSamples.forEach((s) => console.log(`   ${s}`));
console.log(`identical lat==cyrl:   ${latEqCyrl.toLocaleString()}  (untranslated rows)`);
console.log(`identical lat==ru:     ${latEqRu.toLocaleString()}`);
console.log(`identical ru==cyrl:    ${ruEqCyrl.toLocaleString()}`);
console.log(`all three distinct:    ${allDistinct.toLocaleString()}`);

console.log(`\n=== sample of the same code across variants ===`);
let shown = 0;
for (const code of all) {
  if (shown >= 6) break;
  const l = names.lat.get(code), r = names.ru.get(code), c = names.uzcyrl.get(code);
  if (!l || !r || !c) continue;
  if (l === r || l === c) continue;
  console.log(`${code}\n   lat  ${l.slice(0, 78)}\n   cyrl ${c.slice(0, 78)}\n   ru   ${r.slice(0, 78)}`);
  shown++;
}

writeFileSync('docs/gate0-langs.json', JSON.stringify({
  stats,
  join: { union: all.size, inAll3, missingLat, missingRu, missingCyrl, latEqCyrl, latEqRu, ruEqCyrl, allDistinct },
}, null, 2));
console.log('\nwrote docs/gate0-langs.json');
