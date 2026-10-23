// Benchmark of the product module on 1 000 rows: classifyProducts (per pipeline stage) and
// matchProducts against an org that already holds 600 products, plus the Tasnif packaging cache
// cold and warm. Without ANTHROPIC_API_KEY the pipeline runs degraded (no stage 6); a dry-run
// reranker then counts the rows the gate would send, and the cost is estimated the way
// `npm run eval` does (3 characters per input token, 300 output tokens per row, RERANK_* config).
//
//   npx tsx scripts/bench-products.ts            (prints a Markdown block for benchmarks.md)
//   npx tsx scripts/bench-products.ts --no-live  (skips the Tasnif packaging calls)
//   npx tsx scripts/bench-products.ts --match-only (matchProducts and its precision only)
//
// The rows: the demo catalogue (prisma/demo-catalog.json, with barcodes and codes) and the eval
// cases (golden, real-construction, real-metal, synthetic), cycled with seeded name noise
// (eval/noise.ts) to 1 000; per eval row the code is kept (50%), dropped (30%) or replaced by
// another row's code (20%). Everything runs in a "test-" org that is deleted afterwards.
import '@tasnivo/domain/load-env';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { costPer1000Rows } from '@tasnivo/core/match/rerank-usage';
import { rerankConfigFromEnv } from '@tasnivo/core/match/rerank-config';
import { OUTPUT_SCHEMA, renderRow, SYSTEM_PROMPT } from '@tasnivo/core/match/rerank-prompt';
import type { RerankProvider, RerankRequest, RerankVerdict } from '@tasnivo/core/match/types';
import { db } from '@tasnivo/db';
import { auditContext } from '@tasnivo/domain/audit-runner';
import { classifyDetailed } from '@tasnivo/domain/products/classify';
import { matchProducts, upsertProducts, type ProductRecord } from '@tasnivo/domain/products/index';
import { packagesFor } from '@tasnivo/domain/products/packaging';
import { dropOrgs, makeOrg } from '@tasnivo/domain/test-fixtures';
import { parseCsv } from '../eval/csv.js';
import { makeRng, noisify } from '../eval/noise.js';

const ROWS = 1_000;
const CHUNK = 100;
const matchOnly = process.argv.includes('--match-only');
const live = !process.argv.includes('--no-live') && !matchOnly;
const rng = makeRng(20261023);

type Line = { name: string; mxik: string | null; barcode: string | null; unit: string | null };

function baseLines(): Line[] {
  const demo = JSON.parse(readFileSync('packages/db/prisma/demo-catalog.json', 'utf8')) as { rows: string[][]; columnMap: Record<string, number> };
  const m = demo.columnMap;
  const out: Line[] = demo.rows.map((r) => ({ name: r[m['name'] ?? 0] ?? '', barcode: r[m['barcode'] ?? -1] || null, mxik: r[m['mxik'] ?? -1] || null, unit: r[m['unit'] ?? -1] || null }));
  const evalLines: Line[] = [];
  for (const file of ['golden', 'real-construction', 'real-metal', 'synthetic']) {
    const [header, ...rows] = parseCsv(readFileSync(`eval/${file}.csv`, 'utf8'));
    const col = (n: string): number => header?.indexOf(n) ?? -1;
    for (const r of rows) {
      const code = (r[col('correct_code')] ?? '').split('|')[0]?.replace('*', '') ?? '';
      evalLines.push({ name: r[col('name')] ?? '', unit: r[col('unit')] || null, barcode: r[col('barcode')] || null, mxik: /^\d{17}$/.test(code) ? code : null });
    }
  }
  const codes = evalLines.map((l) => l.mxik).filter((c): c is string => c !== null);
  for (const l of evalLines) {
    const roll = rng();
    out.push({ ...l, mxik: roll < 0.5 ? l.mxik : roll < 0.8 ? null : codes[Math.floor(rng() * codes.length)] ?? null });
  }
  return out.filter((l) => l.name.trim());
}

/** The rows, and for each the base row it was made from (itself, or the row a noisy copy came from). */
function thousand(): { lines: Line[]; source: number[] } {
  const base = baseLines();
  const lines: Line[] = [...base];
  const source = base.map((_, i) => i);
  for (let i = 0; lines.length < ROWS; i++) {
    const b = base[i % base.length] as Line;
    lines.push({ ...b, name: noisify(b.name, rng).name });
    source.push(i % base.length);
  }
  return { lines: lines.slice(0, ROWS), source: source.slice(0, ROWS) };
}

/** Counts what the gate would send, never calls anything (eval/run.ts DryRunReranker). */
class DryRunReranker implements RerankProvider {
  readonly name = 'dry run (gate only, no call)';
  readonly available = true;
  rows = 0;
  promptChars = 0;
  rerank(request: RerankRequest): Promise<RerankVerdict[]> {
    this.rows++;
    this.promptChars += renderRow('0', request).length + 2;
    return Promise.resolve([]);
  }
}

const stages = new Map<string, number>();
const timer = { add(stage: string, ms: number) { stages.set(stage, (stages.get(stage) ?? 0) + ms); } };
const ms = (t0: number): number => Math.round(performance.now() - t0);

const { lines, source } = thousand();
const org = await makeOrg('internal');
const out: string[] = [];
try {
  // 600 existing products (the first 600 rows, as the org's catalogue), so matching has something to find.
  const seedRecords: ProductRecord[] = lines.slice(0, 600).map((l) => ({
    productId: null, name: l.name, onecRef: null, mxik: l.mxik, mxikName: null, packageCode: null, packageName: null, unit: l.unit, barcode: l.barcode,
    aliases: [], mxikStatus: 'unchecked', mxikSuggestion: null, markingRequired: null,
  }));
  let t0 = performance.now();
  const seeded = await upsertProducts(org.orgId, null, seedRecords, org.userId, { source: 'manual' });
  const upsertMs = ms(t0);

  t0 = performance.now();
  const ctx = await auditContext(org.orgId, timer);
  if (matchOnly) lines.length = Math.min(lines.length, ROWS);
  const contextMs = ms(t0);
  const dry = new DryRunReranker();
  const configured = ctx.reranker;
  if (!configured.available) ctx.reranker = dry;

  // classifyProducts in chunks of 100, as the import runs it.
  t0 = performance.now();
  const chunkMs: number[] = [];
  const statuses = new Map<string, number>();
  for (let i = 0; !matchOnly && i < lines.length; i += CHUNK) {
    const c0 = performance.now();
    const res = await classifyDetailed(org.orgId, lines.slice(i, i + CHUNK), { ctx, locale: 'ru', packaging: 'off' });
    chunkMs.push(ms(c0));
    for (const r of res) statuses.set(r.mxikStatus, (statuses.get(r.mxikStatus) ?? 0) + 1);
  }
  const classifyMs = ms(t0);

  // matchProducts for all 1 000 at once (one call per invoice in the Didox flow; here the worst case).
  t0 = performance.now();
  const matched = await matchProducts(org.orgId, null, lines);
  const matchMs = ms(t0);
  const byStatus = new Map<string, number>();
  const byBasis = new Map<string, number>();
  // Precision: a row made from one of the first 600 base rows should find that row's product; one
  // from a later base row has none (it is new). Base rows that fold to one identity share a product.
  const truth = { right: 0, wrong: 0, ambiguousWithRight: 0, ambiguousWithout: 0, newRight: 0, newMissed: 0 };
  for (const [i, m] of matched.entries()) {
    byStatus.set(m.status, (byStatus.get(m.status) ?? 0) + 1);
    if (m.chosen) byBasis.set(m.chosen.basis, (byBasis.get(m.chosen.basis) ?? 0) + 1);
    const b = source[i] ?? -1;
    const expected = b >= 0 && b < 600 ? seeded.ids[b] || null : null;
    if (m.status === 'matched') { if (expected && m.chosen?.id === expected) truth.right++; else truth.wrong++; }
    else if (m.status === 'ambiguous') { if (expected && m.candidates.some((c) => c.id === expected)) truth.ambiguousWithRight++; else truth.ambiguousWithout++; }
    else if (expected) truth.newMissed++; else truth.newRight++;
  }
  t0 = performance.now();
  await matchProducts(org.orgId, null, lines.slice(0, 100));
  const match100Ms = ms(t0);

  // Packaging: 50 distinct codes, cold (Tasnif) then warm (packaging_code).
  const codes = [...new Set(lines.map((l) => l.mxik).filter((c): c is string => c !== null))].slice(0, 50);
  let cold = 'skipped (--no-live)';
  let warm = 'skipped';
  if (live) {
    await db.mxikCodeState.updateMany({ where: { code: { in: codes } }, data: { packagesFetchedAt: null } });
    t0 = performance.now();
    const first = await packagesFor(codes);
    cold = `${ms(t0)} ms for ${codes.length} codes (${[...first.values()].filter((s) => s.source === 'live').length} live, ${[...first.values()].filter((s) => s.source === 'unavailable').length} unavailable)`;
    t0 = performance.now();
    const again = await packagesFor(codes);
    warm = `${ms(t0)} ms (${[...again.values()].filter((s) => s.source === 'cache').length} from cache)`;
  }

  const config = rerankConfigFromEnv(process.env);
  const calls = Math.ceil(dry.rows / config.batchSize);
  const inputTokens = Math.round((dry.promptChars + calls * (SYSTEM_PROMPT.length + JSON.stringify(OUTPUT_SCHEMA).length)) / 3);
  const outputTokens = dry.rows * 300;
  const cost = config.price ? (inputTokens * config.price.inputPerMTok + outputTokens * config.price.outputPerMTok) / 1_000_000 : null;
  const usage = { model: config.model, rowsRequested: dry.rows, rowsSent: dry.rows, cacheHits: 0, rowsFailed: 0, codesDiscarded: 0, apiCalls: calls, inputTokens, outputTokens, latencyMs: 0, estimatedCostUsd: cost };

  const sorted = [...chunkMs].sort((a, b) => a - b);
  out.push(
    `Run ${new Date().toISOString()} · ${lines.length} rows · reranker: ${configured.available ? configured.name : `off (${config.disabledReason ?? 'unavailable'}); gate measured with a dry run`} · embedder: ${ctx.setup.embedder.name} · vector stage ${ctx.setup.vectorUsable ? 'on' : 'off'}`,
    '',
    '| Step | Wall time |',
    '|---|---|',
    `| upsertProducts, 600 new products | ${upsertMs} ms (${seeded.created} created) |`,
    `| auditContext (vector readiness, dictionary, restricted list) | ${contextMs} ms |`,
    `| classifyProducts, 1 000 rows in 10 chunks of 100 | ${classifyMs} ms (${(classifyMs / lines.length).toFixed(1)} ms/row; chunk median ${sorted[Math.floor(sorted.length / 2)]} ms, first ${chunkMs[0]} ms, max ${sorted.at(-1)} ms) |`,
    `| matchProducts, 1 000 rows in one call | ${matchMs} ms |`,
    `| matchProducts, 100 rows | ${match100Ms} ms |`,
    `| packagesFor, cold (Tasnif card + history) | ${cold} |`,
    `| packagesFor, warm | ${warm} |`,
    '',
    'classifyProducts per stage (summed over the 8 rows in flight, so the sum exceeds wall time):',
    '',
    '| Stage | Summed ms | Share |',
    '|---|---|---|',
    ...[...stages.entries()].sort((a, b) => b[1] - a[1]).map(([s, v]) => {
      const total = [...stages.values()].reduce((x, y) => x + y, 0);
      return `| ${s} | ${Math.round(v)} | ${((v / total) * 100).toFixed(1)}% |`;
    }),
    '',
    `MXIK status of the 1 000 rows: ${[...statuses.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}.`,
    `matchProducts: ${[...byStatus.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}; matched by ${[...byBasis.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}.`,
    `matchProducts against the known answer: matched right ${truth.right}, matched wrong ${truth.wrong} (precision ${((truth.right / Math.max(1, truth.right + truth.wrong)) * 100).toFixed(1)}%); ambiguous with the right product among the candidates ${truth.ambiguousWithRight}, without it ${truth.ambiguousWithout}; new and truly new ${truth.newRight}, new although the product existed ${truth.newMissed}.`,
    '',
    `Reranker (stage 6) estimate: the gate would send ${dry.rows} of ${lines.length} rows (${((dry.rows / lines.length) * 100).toFixed(1)}%) in ${calls} calls of ${config.batchSize} (RERANK_BATCH_SIZE), ` +
      `~${inputTokens.toLocaleString('en')} input + ${outputTokens.toLocaleString('en')} output tokens on ${config.model} → ` +
      `${cost === null ? 'price unknown' : `$${cost.toFixed(2)} for these rows, $${(costPer1000Rows(usage, lines.length) ?? 0).toFixed(2)} per 1 000 rows`} (gate: confidence < ${config.gate.minConfidence} or margin < ${config.gate.minMargin}). ` +
      'Latency with the key is not measured here (no key on this machine).',
  );
  console.log(out.join('\n'));
} finally {
  await dropOrgs([org.orgId]);
  await db.$disconnect();
}
process.exit(0);
