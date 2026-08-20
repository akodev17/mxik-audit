// Gate 0 feasibility test: the marking flag (`label`) and unitCode exist only on
// per-code endpoints, not in the bulk Excel export. Measure whether enriching all
// ~439k codes is practical, and confirm the two candidate endpoints agree.
import { readRows, readSharedStrings } from './lib/xlsx.js';

const BASE = 'https://tasnif.soliq.uz/api/cls-api';
const TOTAL_CODES = 438_925;

const shared = await readSharedStrings('data/classifier_lat.xlsx');
const codes: string[] = [];
for await (const row of readRows('data/classifier_lat.xlsx', shared)) {
  if (row.index <= 2) continue;
  const c = row.cells[6];
  // Spread the sample across the whole file so we hit varied groups.
  if (c && row.index % 1_400 === 0) codes.push(c);
  if (codes.length >= 300) break;
}
console.log(`sampled ${codes.length} codes spread across the catalog`);

type Fetched = { ok: boolean; ms: number; label: string | null; unitName: string | null; status: number };

// `label` arrives as a JSON number from by-params but a string from elasticsearch/search.
function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return null;
}

async function viaByParams(code: string): Promise<Fetched> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/mxik/search/by-params?mxikCode=${code}&size=1&page=0&lang=uz`);
    const j = (await res.json()) as { data?: { content?: Record<string, unknown>[] } };
    const c = j.data?.content?.[0];
    return {
      ok: !!c, ms: Date.now() - t0, status: res.status,
      label: scalar(c?.['label']), unitName: scalar(c?.['unitName']),
    };
  } catch { return { ok: false, ms: Date.now() - t0, label: null, unitName: null, status: 0 }; }
}

async function viaGetByMxik(code: string): Promise<Fetched> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/mxik/get/by-mxik?mxikCode=${code}&lang=uz`);
    const j = (await res.json()) as Record<string, unknown>;
    return {
      ok: typeof j['mxikCode'] === 'string', ms: Date.now() - t0, status: res.status,
      label: scalar(j['label']), unitName: scalar(j['unitName']),
    };
  } catch { return { ok: false, ms: Date.now() - t0, label: null, unitName: null, status: 0 }; }
}

async function runPool<T>(items: string[], conc: number, fn: (c: string) => Promise<T>): Promise<T[]> {
  const out = new Array<T>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    for (;;) {
      const i = next++;
      const item = items[i];
      if (item === undefined) return;
      out[i] = await fn(item);
    }
  }));
  return out;
}

for (const [name, fn] of [['by-params', viaByParams], ['get/by-mxik', viaGetByMxik]] as const) {
  console.log(`\n=== ${name} ===`);
  for (const conc of [10, 25, 50]) {
    const batch = codes.slice(0, 150);
    const t0 = Date.now();
    const res = await runPool(batch, conc, fn);
    const wall = Date.now() - t0;
    const ok = res.filter((r) => r.ok).length;
    const statuses = [...new Set(res.map((r) => r.status))].join(',');
    const rps = (batch.length / (wall / 1000));
    const projSec = TOTAL_CODES / rps;
    console.log(`conc=${String(conc).padStart(2)}  ${batch.length} reqs in ${(wall / 1000).toFixed(1)}s  ok=${ok}  statuses=${statuses}  ${rps.toFixed(0)} req/s  → full catalog ≈ ${(projSec / 60).toFixed(0)} min`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// Do the two endpoints agree, and how often is label set?
console.log('\n=== label / unit agreement on 120 codes ===');
const sample = codes.slice(0, 120);
const a = await runPool(sample, 20, viaByParams);
const b = await runPool(sample, 20, viaGetByMxik);
let labelAgree = 0, unitAgree = 0, marked = 0, labelMissing = 0, bothOk = 0;
for (let i = 0; i < sample.length; i++) {
  const x = a[i]; const y = b[i];
  if (!x || !y) continue;
  if (x.ok && y.ok) {
    bothOk++;
    if (x.label === y.label) labelAgree++;
    if (x.unitName === y.unitName) unitAgree++;
  }
  if (x.label === '1') marked++;
  if (x.ok && x.label === null) labelMissing++;
}
console.log(`bothOk=${bothOk}/${sample.length}  labelAgree=${labelAgree}  unitAgree=${unitAgree}`);
console.log(`label==='1' (marked): ${marked}/${sample.length} (${((marked / sample.length) * 100).toFixed(0)}%)  label null: ${labelMissing}`);
console.log(`expected marked share from portal stats: ${((100_060 / TOTAL_CODES) * 100).toFixed(0)}%`);
