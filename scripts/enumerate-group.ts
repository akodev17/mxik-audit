// Walks the portal's own hierarchy endpoints down to leaf codes for one group,
// then diffs the result against the Excel export. Used in Gate 0 to test whether
// the API exposes codes the export omits (i.e. whether archived codes are reachable).
// Run: tsx scripts/enumerate-group.ts 001
import { writeFileSync } from 'node:fs';
import { readRows, readSharedStrings } from './lib/xlsx.js';

const BASE = 'https://tasnif.soliq.uz/api/cls-api';
const GROUP = process.argv[2] ?? '001';

type Node = { code: string; name: string | null; count: number | null };

async function level(path: string, param: string, value: string): Promise<Node[]> {
  const out: Node[] = [];
  for (let page = 0; page < 200; page++) {
    const url = `${BASE}/${path}?${param}=${value}&size=200&page=${page}&lang=uz`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return out;
    const j = (await res.json()) as { data?: unknown; recordTotal?: number };
    const arr = Array.isArray(j.data) ? j.data : [];
    for (const raw of arr) {
      const r = raw as Record<string, unknown>;
      const code = typeof r['code'] === 'string' ? r['code'] : null;
      if (!code) continue;
      out.push({
        code,
        name: typeof r['mxikName'] === 'string' ? r['mxikName'] : (typeof r['name'] === 'string' ? r['name'] : null),
        count: typeof r['count'] === 'number' ? r['count'] : null,
      });
    }
    if (arr.length < 200) break;
  }
  return out;
}

console.log(`enumerating group ${GROUP} through the portal hierarchy...`);
const leaves = new Map<string, string | null>();
const levelCounts = { classes: 0, positions: 0, subPositions: 0, brands: 0, attributes: 0 };
const claimed = { classes: 0, positions: 0, subPositions: 0, brands: 0 };

const classes = await level('class/short-info', 'groupCode', GROUP);
levelCounts.classes = classes.length;
claimed.classes = classes.reduce((s, c) => s + (c.count ?? 0), 0);

for (const cls of classes) {
  const positions = await level('position/short-info', 'classCode', cls.code);
  levelCounts.positions += positions.length;
  claimed.positions += positions.reduce((s, p) => s + (p.count ?? 0), 0);
  for (const pos of positions) {
    const subs = await level('subposition/short-info', 'positionCode', pos.code);
    levelCounts.subPositions += subs.length;
    claimed.subPositions += subs.reduce((s, x) => s + (x.count ?? 0), 0);
    for (const sub of subs) {
      const brands = await level('brand/short-info', 'subPositionCode', sub.code);
      levelCounts.brands += brands.length;
      claimed.brands += brands.reduce((s, b) => s + (b.count ?? 0), 0);
      for (const brand of brands) {
        const attrs = await level('attribute/by-brand', 'brandCode', brand.code);
        levelCounts.attributes += attrs.length;
        for (const a of attrs) leaves.set(a.code, a.name);
      }
    }
  }
}

console.log(`\nlevels walked: ${JSON.stringify(levelCounts)}`);
console.log(`sum of "count" fields per level: ${JSON.stringify(claimed)}`);
console.log(`distinct leaf codes from API tree: ${leaves.size}`);

// Excel side
const shared = await readSharedStrings('data/classifier_lat.xlsx');
const excel = new Set<string>();
for await (const row of readRows('data/classifier_lat.xlsx', shared)) {
  if (row.index <= 2) continue;
  const c = row.cells[6];
  if (c && c.startsWith(GROUP)) excel.add(c);
}
console.log(`Excel codes in group ${GROUP}: ${excel.size}`);

const onlyApi = [...leaves.keys()].filter((c) => !excel.has(c));
const onlyExcel = [...excel].filter((c) => !leaves.has(c));
console.log(`\nAPI-only codes: ${onlyApi.length}`);
console.log(`Excel-only codes: ${onlyExcel.length}`);

// Any API-only code is an archive candidate: check its status.
const checked: Record<string, unknown>[] = [];
for (const code of onlyApi.slice(0, 20)) {
  const res = await fetch(`${BASE}/integration-mxik/get/history/${code}`);
  const j = (await res.json()) as { data?: Record<string, unknown> };
  const d = j.data ?? {};
  checked.push({ code, isActive: d['isActive'], status: d['status'], createdAt: d['createdAt'], updatedAt: d['updatedAt'], name: leaves.get(code) });
  console.log(`  API-only ${code} isActive=${String(d['isActive'])} status=${String(d['status'])} created=${String(d['createdAt'])} ${String(leaves.get(code) ?? '').slice(0, 40)}`);
}
for (const code of onlyExcel.slice(0, 20)) {
  const res = await fetch(`${BASE}/integration-mxik/get/history/${code}`);
  const j = (await res.json()) as { data?: Record<string, unknown> };
  const d = j.data ?? {};
  console.log(`  Excel-only ${code} isActive=${String(d['isActive'])} status=${String(d['status'])} created=${String(d['createdAt'])}`);
  checked.push({ code, side: 'excel-only', isActive: d['isActive'], status: d['status'] });
}

writeFileSync(`docs/gate0-enumerate-${GROUP}.json`, JSON.stringify({
  group: GROUP, levelCounts, claimed,
  apiLeafCount: leaves.size, excelCount: excel.size,
  onlyApi, onlyExcel, checked,
}, null, 2));
console.log(`\nwrote docs/gate0-enumerate-${GROUP}.json`);
