// Are the unresolved marking flags a systematic class of codes, or transient failures?
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const BASE = 'https://tasnif.soliq.uz/api/cls-api';
const unresolved: string[] = [];
const resolvedByGroup = new Map<string, number>();
const unresolvedByGroup = new Map<string, number>();
let total = 0;

const rl = createInterface({ input: createReadStream('data/mxik.ndjson', 'utf8'), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const r = JSON.parse(line) as { code: string; isMarked: boolean | null; groupCode: string };
  total++;
  if (r.isMarked === null) {
    unresolvedByGroup.set(r.groupCode, (unresolvedByGroup.get(r.groupCode) ?? 0) + 1);
    if (unresolved.length < 40) unresolved.push(r.code);
  } else {
    resolvedByGroup.set(r.groupCode, (resolvedByGroup.get(r.groupCode) ?? 0) + 1);
  }
}
console.log(`total=${total.toLocaleString()}  unresolved=${[...unresolvedByGroup.values()].reduce((a, b) => a + b, 0).toLocaleString()}`);

console.log('\ngroups with the highest unresolved SHARE:');
const shares = [...unresolvedByGroup].map(([g, n]) => {
  const ok = resolvedByGroup.get(g) ?? 0;
  return { g, n, ok, share: n / (n + ok) };
}).sort((a, b) => b.share - a.share);
shares.slice(0, 12).forEach((s) => console.log(`  grp ${s.g}  unresolved=${String(s.n).padStart(6)}  resolved=${String(s.ok).padStart(6)}  share=${(s.share * 100).toFixed(0)}%`));
console.log(`\ngroups fully unresolved (share 100%): ${shares.filter((s) => s.share === 1).length}`);
console.log(`groups partially unresolved:          ${shares.filter((s) => s.share < 1).length}`);

console.log('\nretrying 40 unresolved codes sequentially:');
let nowOk = 0;
for (const code of unresolved) {
  const res = await fetch(`${BASE}/mxik/search/by-params?mxikCode=${code}&size=1&page=0&lang=uz`);
  const j = (await res.json()) as { data?: { content?: Record<string, unknown>[] }; success?: boolean };
  const c = j.data?.content?.[0];
  const label = c?.['label'];
  if (label !== undefined && label !== null) nowOk++;
  if (unresolved.indexOf(code) < 8) {
    console.log(`  ${code} http=${res.status} success=${String(j.success)} content=${j.data?.content?.length ?? 0} label=${JSON.stringify(label)}`);
  }
}
console.log(`\nof 40 retried, ${nowOk} now resolved -> ${nowOk > 30 ? 'TRANSIENT (retry fixes it)' : nowOk === 0 ? 'SYSTEMATIC (endpoint never serves these)' : 'MIXED'}`);
