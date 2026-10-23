// Didox benchmark (programme brief §5): a 100-line invoice and a 1 000-line batch (10 invoices × 100)
// through parse → match (stubbed: an in-memory catalogue of 5 000 products, exact folded-name
// lookup, since Agent 4's matcher is not on this branch) → validate → write (the real database
// transaction into import_batch / import_record / didox_document). Runs against DATABASE_URL in a
// throw-away org that is deleted afterwards.
//
//   npx tsx packages/domain/src/didox/bench.ts [repetitions=5]
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { db } from '@tasnivo/db';
import { checkInvoice, type CheckDeps, type MatchResult, type ProductRecord } from './check.js';
import { parseDidoxDocument } from './document.js';
import { foldName } from './fold.js';
import JSZip from 'jszip';
import { storeInvoice, uploadDidoxFile } from './service.js';

const NAMES = ['Болт', 'Гайка', 'Шайба', 'Саморез', 'Дюбель', 'Краска', 'Грунтовка', 'Кабель', 'Розетка', 'Выключатель', 'Лампа', 'Труба', 'Уголок', 'Кран', 'Герметик', 'Цемент', 'Арматура', 'Кирпич', 'Гвозди', 'Профиль'];

/** One synthetic invoice in Didox's lower-case shape: `lines` lines, two spellings of some names. */
export function syntheticInvoice(no: number, lines: number): Record<string, unknown> {
  const products = Array.from({ length: lines }, (_, i) => {
    const count = (i % 9) + 1;
    const price = 1000 + i * 37.5;
    const sum = Math.round(count * price * 100) / 100;
    const vat = Math.round(sum * 12) / 100;
    const name = `${NAMES[i % NAMES.length]} ${i % 7 === 3 ? 'М-' : 'М'}${(i % 40) * 10} ${i % 5}кг`;
    return {
      ordno: i + 1, name, catalogcode: String(10_000_000_000_000_000 + (i % 300) * 1_000_000 + 1_000).padStart(17, '0'),
      packagename: i % 3 ? 'штук' : 'упаковка', count, summa: price, deliverysum: sum, vatrate: 12, vatsum: vat, deliverysumwithvat: Math.round((sum + vat) * 100) / 100,
    };
  });
  return {
    facturaid: `bench-${no}-${randomBytes(4).toString('hex')}`,
    facturadoc: { facturano: `B-${no}`, facturadate: '2026-10-23' },
    contractdoc: { contractno: '1/2026', contractdate: '2026-01-01' },
    sellertin: '302345678', buyertin: '305123456', seller: { name: 'Bench Seller' }, buyer: { name: 'Bench Buyer' },
    productlist: { products },
  };
}

/** The stubbed matcher: 5 000 known products keyed by folded name; time spent is reported as "match". */
function stubDeps(timer: { match: number }): CheckDeps {
  const catalogue = new Map<string, ProductRecord>();
  for (let i = 0; i < 5_000; i++) {
    const name = `${NAMES[i % NAMES.length]} М${(i % 40) * 10} ${i % 5}кг`;
    catalogue.set(foldName(name), {
      productId: `p${i}`, name, onecRef: null, mxik: String(10_000_000_000_000_000 + (i % 300) * 1_000_000 + 1_000).padStart(17, '0'), mxikName: null,
      packageCode: null, packageName: i % 2 ? 'штук' : 'упаковка', unit: null, barcode: null, aliases: [], mxikStatus: 'ok', mxikSuggestion: null, markingRequired: null,
    });
  }
  return {
    matchProducts: (_o, _c, queries) => {
      const t = performance.now();
      const out = queries.map((q): MatchResult => {
        const hit = catalogue.get(foldName(q.name));
        if (!hit) return { status: 'new', chosen: null, candidates: [] };
        const c = { id: hit.productId ?? '', label: hit.name, confidence: 1, basis: 'name_normalized' as const };
        return { status: 'matched', chosen: c, candidates: [c] };
      });
      timer.match += performance.now() - t;
      return Promise.resolve(out);
    },
    classifyProducts: (_o, queries) => Promise.resolve(queries.map((q) => ({ mxik: q.mxik ?? null, mxikName: null, mxikStatus: 'ok' as const, mxikSuggestion: null, packageCode: null, packageName: null, markingRequired: null, issues: [] }))),
    matchCounterparties: (_o, refs) => Promise.resolve(refs),
    productRecords: (_o, ids) => Promise.resolve(ids.flatMap((id) => [...catalogue.values()].filter((p) => p.productId === id).slice(0, 1))),
  };
}

type Stage = { parse: number; match: number; validate: number; write: number; total: number };

async function runBatch(orgId: string, invoices: Array<Record<string, unknown>>): Promise<Stage> {
  const s: Stage = { parse: 0, match: 0, validate: 0, write: 0, total: 0 };
  const timer = { match: 0 };
  const deps = stubDeps(timer);
  const start = performance.now();
  for (const json of invoices) {
    let t = performance.now();
    const parsed = parseDidoxDocument(json, { source: 'didox_json' });
    s.parse += performance.now() - t;
    if (!parsed.ok) throw new Error(parsed.error);
    t = performance.now();
    const before = timer.match;
    const checked = await checkInvoice(orgId, null, parsed.invoice, deps);
    const checkMs = performance.now() - t;
    s.match += timer.match - before;
    s.validate += checkMs - (timer.match - before);
    t = performance.now();
    const stored = await storeInvoice(orgId, null, { json, source: 'didox_json', clientId: null }, parsed.invoice, checked);
    s.write += performance.now() - t;
    if (!stored.ok) throw new Error(stored.code);
  }
  s.total = performance.now() - start;
  return s;
}

/** The same 1 000 lines as one Didox-style zip of zips through the upload path (zip-guard, unzip, duplicate checks, parse, check, write). */
async function runUpload(orgId: string, userId: string, invoices: Array<Record<string, unknown>>): Promise<number> {
  const outer = new JSZip();
  for (const [i, json] of invoices.entries()) {
    const inner = new JSZip();
    inner.file('doc.json', JSON.stringify(json));
    outer.file(`${i}.zip`, await inner.generateAsync({ type: 'nodebuffer' }));
  }
  const body = await outer.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const user = { userId, orgId, email: 'bench@test.local', demo: false, clientId: null, role: 'admin' as const, clientIds: null };
  const t = performance.now();
  const res = await uploadDidoxFile(user, 'ru', { file: { name: 'bench.zip', size: body.length, read: () => Promise.resolve(body) }, clientId: null }, stubDeps({ match: 0 }));
  const ms = performance.now() - t;
  if (!res.ok || res.kind !== 'documents' || res.items.some((x) => !x.ok)) throw new Error(JSON.stringify(res).slice(0, 300));
  return ms;
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

async function main(): Promise<void> {
  const reps = Number(process.argv[2] ?? 5);
  const org = await db.organization.create({ data: { name: `bench-didox-${randomBytes(4).toString('hex')}`, kind: 'customer' } });
  const user = await db.user.create({ data: { orgId: org.id, email: `bench-${randomBytes(4).toString('hex')}@test.local`, passwordHash: 'x' } });
  try {
    const results: Record<string, Stage[]> = { '100-line invoice': [], '1 000-line batch (10 × 100)': [] };
    const uploads: number[] = [];
    // One warm-up run (module loading, Prisma connection, JIT) is not counted.
    await runBatch(org.id, [syntheticInvoice(0, 100)]);
    for (let r = 0; r < reps; r++) {
      results['100-line invoice']?.push(await runBatch(org.id, [syntheticInvoice(1000 + r, 100)]));
      results['1 000-line batch (10 × 100)']?.push(await runBatch(org.id, Array.from({ length: 10 }, (_, i) => syntheticInvoice(2000 + r * 10 + i, 100))));
      uploads.push(await runUpload(org.id, user.id, Array.from({ length: 10 }, (_, i) => syntheticInvoice(3000 + r * 10 + i, 100))));
    }
    const rows = Object.entries(results).map(([name, runs]) => {
      const pick = (k: keyof Stage): string => median(runs.map((x) => x[k])).toFixed(1);
      return `| ${name} | ${pick('parse')} | ${pick('match')} | ${pick('validate')} | ${pick('write')} | ${pick('total')} |`;
    });
    console.log(`median of ${reps} runs, milliseconds\n| Case | parse | match (stub) | validate | write (DB) | total |\n|---|---|---|---|---|---|\n${rows.join('\n')}`);
    console.log(`| 1 000-line zip of zips through uploadDidoxFile (end to end, incl. unzip and duplicate checks) | | | | | ${median(uploads).toFixed(1)} |`);
  } finally {
    await db.organization.delete({ where: { id: org.id } });
    await db.$disconnect();
  }
}

if (process.argv[1]?.endsWith('bench.ts')) void main();
