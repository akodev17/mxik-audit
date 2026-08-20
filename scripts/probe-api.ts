// Gate 0 API probe. Answers: accepted `lang` values, which script each endpoint
// returns, search quality vs the Excel export, rate-limit behaviour, and whether
// archive/deprecation status is obtainable anywhere.
// Run: npm run probe:api
import { writeFileSync } from 'node:fs';
import { readRows, readSharedStrings } from './lib/xlsx.js';

const BASE = 'https://tasnif.soliq.uz/api/cls-api';
const CODE_COL = 6;
const NAME_COL = 7;

type Json = Record<string, unknown>;
type Probe = { label: string; url: string; status: number; ms: number; note: string };

const probes: Probe[] = [];

async function get(url: string): Promise<{ status: number; ms: number; body: unknown }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* non-JSON response body */ }
    return { status: res.status, ms: Date.now() - t0, body };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, body: { error: String(e) } };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Safe stringify for the loosely-typed JSON this script pokes at. */
function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

function scriptOf(s: string): 'cyrillic' | 'latin' | 'mixed' | 'other' {
  const cyr = /[Ѐ-ӿ]/.test(s);
  const lat = /[A-Za-z]/.test(s);
  if (cyr && lat) return 'mixed';
  if (cyr) return 'cyrillic';
  if (lat) return 'latin';
  return 'other';
}

// ---------------------------------------------------------------- Excel code set
console.log('loading Excel code set (for API-vs-Excel diffing)...');
const shared = await readSharedStrings('data/classifier_lat.xlsx');
const excelCodes = new Set<string>();
const excelPerGroup = new Map<string, number>();
const excelNames = new Map<string, string>();
const sampleCodes: string[] = [];
for await (const row of readRows('data/classifier_lat.xlsx', shared)) {
  if (row.index <= 2) continue;
  const code = row.cells[CODE_COL];
  if (!code) continue;
  excelCodes.add(code);
  const g = code.slice(0, 3);
  excelPerGroup.set(g, (excelPerGroup.get(g) ?? 0) + 1);
  if (excelNames.size < 400_000) excelNames.set(code, row.cells[NAME_COL] ?? '');
  // Spread the sample across the file rather than taking the first N.
  if (row.index % 21_946 === 0 && sampleCodes.length < 20) sampleCodes.push(code);
}
console.log(`excel codes: ${excelCodes.size.toLocaleString()}  groups: ${excelPerGroup.size}`);

// ---------------------------------------------------------------- 1. lang values
console.log('\n=== 1. accepted `lang` values on /elasticsearch/search ===');
const langReport: Json = {};
for (const lang of ['uz', 'ru', 'uz_cyrl', 'uzc', 'lat', 'en', 'kaa', '', 'garbage']) {
  const r = await get(`${BASE}/elasticsearch/search?search=sement&size=3&page=0&lang=${lang}`);
  const data = (r.body as Json | undefined)?.['data'];
  const first = Array.isArray(data) ? (data[0] as Json | undefined) : undefined;
  const name = typeof first?.['name'] === 'string' ? first['name'] : '';
  langReport[lang || '(empty)'] = { status: r.status, script: name ? scriptOf(name) : null, sample: name.slice(0, 70) };
  console.log(`lang=${(lang || '(empty)').padEnd(9)} http=${r.status} script=${(name ? scriptOf(name) : '-').padEnd(9)} ${name.slice(0, 60)}`);
  probes.push({ label: `lang=${lang}`, url: 'elasticsearch/search', status: r.status, ms: r.ms, note: name ? scriptOf(name) : 'no data' });
  await sleep(120);
}

// ---------------------------------------------------------------- 2. 20 queries
console.log('\n=== 2. twenty varied search queries ===');
const QUERIES: { q: string; kind: string }[] = [
  { q: 'sement', kind: 'uz-latin' },
  { q: 'цемент', kind: 'ru' },
  { q: 'цемент портланд', kind: 'ru-multiword' },
  { q: 'sut', kind: 'uz-latin short' },
  { q: 'сут', kind: 'uz-cyrillic' },
  { q: 'молоко', kind: 'ru' },
  { q: "no'xat", kind: 'uz-latin apostrophe' },
  { q: 'noxat', kind: 'uz-latin no apostrophe' },
  { q: 'noʻxat', kind: 'uz-latin U+02BB' },
  { q: 'palov', kind: 'uz prepared dish' },
  { q: 'палов', kind: 'uz-cyrillic dish' },
  { q: 'shakar', kind: 'uz sugar' },
  { q: 'сахар', kind: 'ru sugar' },
  { q: 'Coca-Cola 1.5L', kind: 'brand + noise' },
  { q: 'Coca Cola', kind: 'brand clean' },
  { q: 'tibbiy xizmat', kind: 'uz service' },
  { q: 'gilam', kind: 'uz carpet' },
  { q: 'ковер', kind: 'ru carpet' },
  { q: 'paracetamol', kind: 'pharma INN' },
  { q: 'sem', kind: 'partial prefix' },
];
const searchReport: Json[] = [];
for (const { q, kind } of QUERIES) {
  const r = await get(`${BASE}/elasticsearch/search?search=${encodeURIComponent(q)}&size=5&page=0&lang=uz`);
  const b = r.body as Json;
  const data = Array.isArray(b?.['data']) ? (b['data'] as Json[]) : [];
  const total = typeof b?.['recordTotal'] === 'number' ? b['recordTotal'] : null;
  const top = data[0];
  const topName = typeof top?.['name'] === 'string' ? top['name'] : '';
  const topCode = typeof top?.['mxikCode'] === 'string' ? top['mxikCode'] : '';
  const inExcel = data.filter((d) => typeof d['mxikCode'] === 'string' && excelCodes.has(d['mxikCode'])).length;
  searchReport.push({ q, kind, status: r.status, ms: r.ms, total, returned: data.length, inExcel, topCode, topName });
  console.log(`${q.padEnd(18)} ${String(kind).padEnd(22)} http=${r.status} total=${String(total ?? '-').padStart(7)} ret=${data.length} inExcel=${inExcel}/${data.length}  ${topName.slice(0, 44)}`);
  await sleep(120);
}

// ---------------------------------------------------------------- 3. barcode search
console.log('\n=== 3. barcode (gtin) search via /mxik/search/by-params ===');
const barcodeTargets: { code: string; gtin: string }[] = [];
{
  const shared2 = await readSharedStrings('data/classifier_lat.xlsx');
  let n = 0;
  for await (const row of readRows('data/classifier_lat.xlsx', shared2)) {
    if (row.index <= 2) continue;
    const bc = row.cells[8];
    const code = row.cells[CODE_COL];
    if (bc && code && bc.length === 13 && n < 5 && row.index % 4001 === 0) { barcodeTargets.push({ code, gtin: bc }); n++; }
    if (n >= 5) break;
  }
}
const barcodeReport: Json[] = [];
for (const t of barcodeTargets) {
  const r = await get(`${BASE}/mxik/search/by-params?gtin=${t.gtin}&size=5&page=0&lang=uz`);
  const b = r.body as Json;
  const d = b?.['data'] as Json | undefined;
  const content = Array.isArray(d?.['content']) ? (d['content'] as Json[]) : [];
  const hit = content.some((c) => c['mxikCode'] === t.code);
  barcodeReport.push({ gtin: t.gtin, expected: t.code, status: r.status, returned: content.length, exactHit: hit });
  console.log(`gtin=${t.gtin} expect=${t.code} http=${r.status} ret=${content.length} exactHit=${hit}`);
  await sleep(150);
}

// ---------------------------------------------------------------- 4. archive status
console.log('\n=== 4. archive / deprecation status ===');
const historyReport: Json[] = [];
for (const code of sampleCodes.slice(0, 10)) {
  const r = await get(`${BASE}/integration-mxik/get/history/${code}`);
  const b = r.body as Json;
  const d = b?.['data'] as Json | undefined;
  historyReport.push({
    code, status: r.status, inExcel: excelCodes.has(code),
    isActive: d?.['isActive'] ?? null, statusField: d?.['status'] ?? null,
    createdAt: d?.['createdAt'] ?? null, updatedAt: d?.['updatedAt'] ?? null,
    keys: d ? Object.keys(d) : [],
  });
  console.log(`${code} http=${r.status} isActive=${String(d?.['isActive'])} status=${String(d?.['status'])} created=${String(d?.['createdAt'])}`);
  await sleep(150);
}

// Per-group count diff: /group reports more codes than the export contains.
console.log('\n--- per-group count: API mxikCount vs Excel rows ---');
const gRes = await get(`${BASE}/group?lang=uz&size=200&page=0`);
const gData = (gRes.body as Json)?.['data'];
const apiGroups = Array.isArray(gData) ? (gData as Json[]) : [];
let apiTotal = 0;
const groupDiffs: Json[] = [];
for (const g of apiGroups) {
  const code = String(g['code']);
  const cnt = typeof g['mxikCount'] === 'number' ? g['mxikCount'] : 0;
  apiTotal += cnt;
  const excel = excelPerGroup.get(code) ?? 0;
  if (cnt !== excel) groupDiffs.push({ code, name: str(g['nameUz']).slice(0, 44), api: cnt, excel, delta: cnt - excel });
}
groupDiffs.sort((a, b) => Math.abs(Number(b['delta'])) - Math.abs(Number(a['delta'])));
console.log(`API groups=${apiGroups.length}  API total=${apiTotal.toLocaleString()}  Excel total=${excelCodes.size.toLocaleString()}  delta=${(apiTotal - excelCodes.size).toLocaleString()}`);
console.log(`groups where counts disagree: ${groupDiffs.length}`);
groupDiffs.slice(0, 15).forEach((d) => console.log(`  grp ${str(d['code'])} api=${str(d['api']).padStart(7)} excel=${str(d['excel']).padStart(7)} delta=${str(d['delta']).padStart(6)}  ${str(d['name'])}`));

// Hunt for codes the API knows but the export omits: those are archive candidates.
console.log('\n--- codes returned by search but absent from Excel (archive candidates) ---');
const orphanCandidates: Json[] = [];
const HUNT = ['tibbiy', 'xizmat', 'услуга', 'медицинская услуга', 'dori', 'лекарство', 'sement', 'gilam', 'ковер', 'palov'];
for (const q of HUNT) {
  const r = await get(`${BASE}/elasticsearch/search?search=${encodeURIComponent(q)}&size=50&page=0&lang=uz`);
  const data = (r.body as Json)?.['data'];
  const arr = Array.isArray(data) ? (data as Json[]) : [];
  for (const it of arr) {
    const c = it['mxikCode'];
    if (typeof c === 'string' && !excelCodes.has(c)) {
      orphanCandidates.push({ q, code: c, name: str(it['name']).slice(0, 60) });
    }
  }
  await sleep(150);
}
console.log(`orphans found: ${orphanCandidates.length}`);
for (const o of orphanCandidates.slice(0, 10)) {
  const r = await get(`${BASE}/integration-mxik/get/history/${str(o['code'])}`);
  const d = (r.body as Json)?.['data'] as Json | undefined;
  console.log(`  ${str(o['code'])} isActive=${str(d?.['isActive'])} status=${str(d?.['status'])} q="${str(o['q'])}"  ${str(o['name'])}`);
  o['isActive'] = d?.['isActive'] ?? null;
  o['statusField'] = d?.['status'] ?? null;
  await sleep(150);
}

// Does anything expose a replacement code?
console.log('\n--- searching every history field name for a replacement pointer ---');
const rSample = await get(`${BASE}/integration-mxik/get/history/${sampleCodes[0]}`);
const dSample = (rSample.body as Json)?.['data'] as Json | undefined;
const allKeys = dSample ? Object.keys(dSample) : [];
const replacementish = allKeys.filter((k) => /replac|new|old|instead|substit|prev|next|archiv|delet|revok/i.test(k));
console.log(`history fields (${allKeys.length}): ${allKeys.join(', ')}`);
console.log(`replacement-looking fields: ${replacementish.length ? replacementish.join(', ') : 'NONE'}`);

// ---------------------------------------------------------------- 5. rate limit
console.log('\n=== 5. rate-limit behaviour ===');
const rateReport: Json[] = [];
for (const conc of [1, 5, 15, 30]) {
  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: conc }, (_, i) =>
      get(`${BASE}/elasticsearch/search?search=sement&size=2&page=${i}&lang=uz`)),
  );
  const ms = Date.now() - t0;
  const codes = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1; return acc;
  }, {});
  const slowest = Math.max(...results.map((r) => r.ms));
  rateReport.push({ concurrency: conc, wallMs: ms, slowestMs: slowest, statuses: codes });
  console.log(`concurrency=${String(conc).padStart(2)} wall=${String(ms).padStart(6)}ms slowest=${String(slowest).padStart(6)}ms statuses=${JSON.stringify(codes)}`);
  await sleep(600);
}
// Sustained burst to see whether a limiter engages over time.
{
  const t0 = Date.now();
  let ok = 0; let bad = 0; const statuses = new Set<number>();
  for (let i = 0; i < 60; i++) {
    const r = await get(`${BASE}/elasticsearch/search?search=sut&size=1&page=${i % 10}&lang=uz`);
    statuses.add(r.status);
    if (r.status === 200) ok++; else bad++;
  }
  const ms = Date.now() - t0;
  console.log(`sustained 60 sequential: ok=${ok} bad=${bad} statuses=${[...statuses].join(',')} wall=${(ms / 1000).toFixed(1)}s avg=${Math.round(ms / 60)}ms`);
  rateReport.push({ sustained: 60, ok, bad, statuses: [...statuses], wallMs: ms });
}

writeFileSync('docs/gate0-api-report.json', JSON.stringify({
  base: BASE,
  excelCodes: excelCodes.size,
  lang: langReport,
  search: searchReport,
  barcode: barcodeReport,
  history: historyReport,
  historyFields: allKeys,
  replacementFields: replacementish,
  groupDiff: { apiTotal, excelTotal: excelCodes.size, delta: apiTotal - excelCodes.size, disagreeing: groupDiffs },
  orphanCandidates,
  rate: rateReport,
}, null, 2));
console.log('\nwrote docs/gate0-api-report.json');
