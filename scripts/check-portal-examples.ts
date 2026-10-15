// Re-runs the portal search examples quoted on the landing page, so they can be
// re-checked before every demo instead of trusted from the Gate 0 snapshot.
// Seven read-only queries against the portal's public search, one at a time.
//
// Writes docs/portal-examples.json with today's date and prints a table.
// Run: npm run check:portal-examples
import { writeFileSync } from 'node:fs';

const BASE = 'https://tasnif.soliq.uz/api/cls-api';

/** Every query the landing page quotes, with what it claims the portal returns. */
const EXAMPLES = [
  { q: 'Coca-Cola 1.5L', claim: 'top hit is a medicine (Paracetamol / Цефекон Д)' },
  { q: 'Coca Cola', claim: '68 results, top hit correct' },
  { q: "no'xat", claim: '1 result, wrong (acrylic polymer dispersion)' },
  { q: 'noʻxat', claim: '105 results' },
  { q: 'цемент портланд', claim: '0 results' },
  { q: 'tibbiy xizmat', claim: '0 results' },
  { q: 'тиббий хизмат', claim: '297 results, kettles and nappies on top' },
] as const;

type Hit = { mxikCode?: unknown; name?: unknown };

const results = [];
for (const { q, claim } of EXAMPLES) {
  const url = `${BASE}/elasticsearch/search?search=${encodeURIComponent(q)}&size=5&page=0&lang=uz`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = (await res.json().catch(() => ({}))) as { data?: Hit[]; recordTotal?: unknown };
  const data = Array.isArray(body.data) ? body.data : [];
  const top = data.slice(0, 3).map((d) => ({
    code: typeof d.mxikCode === 'string' ? d.mxikCode : '',
    name: typeof d.name === 'string' ? d.name : '',
  }));
  const total = typeof body.recordTotal === 'number' ? body.recordTotal : null;
  results.push({ q, claim, status: res.status, total, top });
  console.log(`${q.padEnd(18)} http=${res.status} total=${String(total ?? '-').padStart(5)}  ${top[0]?.name.slice(0, 60) ?? ''}`);
  await new Promise((r) => setTimeout(r, 300));
}

const checkedAt = new Date().toISOString().slice(0, 10);
writeFileSync('docs/portal-examples.json', `${JSON.stringify({ checkedAt, base: BASE, results }, null, 2)}\n`);
console.log(`\nwrote docs/portal-examples.json (${checkedAt})`);
