// Re-audits stored catalogues in memory with the current engine and diffs the
// finding types row by row against the audit stored in the database (plan §6:
// a row must not turn MISMATCH because normalisation changed). Writes nothing
// to the catalogues: checkItem() only reads. The demo template is also scored
// against its labels (prisma/demo-catalog.json), before and after, the way
// `npm run demo:quality` scores the stored audit. Rows of an eval CSV (no
// stored audit) can be re-audited too, for their finding counts.
// Appends to docs/reaudit-results.json.
// Run: npm run reaudit:diff [-- --catalog <id> ... --csv eval/real-metal.csv --label "..."]
//      With no --catalog: the newest demo template, every customer catalogue with rows.
import '@tasnivo/domain/load-env'; // must precede anything reading process.env
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { parseCases } from '../eval/cases.js';
import { auditContext, checkItem, type AuditableItem } from '@tasnivo/domain/audit-runner';
import { db } from '@tasnivo/db';
import { bandOf } from '@tasnivo/core/match/score';

const RESULTS = 'docs/reaudit-results.json';
/**
 * The finding types checkItem produces. Privilege findings come from a separate
 * pass after the audit (audit-jobs.ts runPrivilegeCheck) and are left out of
 * the comparison; NOT_PURCHASED needs purchase data the re-audit does not load.
 */
const ENGINE_TYPES = new Set(['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT']);
const args = process.argv.slice(2);
const values = (flag: string): string[] => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1] as string] : []));
const LABEL = values('--label')[0] ?? 'reaudit diff';

const Label = z.object({ intent: z.enum(['clean', 'missing', 'not_found', 'wrong_code', 'unit_conflict']), correctCode: z.string() }).nullable();
const EXPECTED = { missing: 'MISSING', not_found: 'NOT_FOUND', wrong_code: 'MISMATCH', unit_conflict: 'UNIT_CONFLICT' } as const;
const demoLabels = existsSync('packages/db/prisma/demo-catalog.json')
  ? z.object({ labels: z.array(Label) }).parse(JSON.parse(readFileSync('packages/db/prisma/demo-catalog.json', 'utf8'))).labels
  : [];

type RowFindings = { types: string[]; suggested: string | null; band: string | null };
type Scored = { flagged: Record<string, number>; correct: Record<string, number>; missed: Record<string, number>; cleanFlagged: number; cleanRows: number; rightSuggestion: number; needSuggestion: number };

/** demo:quality's scoring of one audit of the demo template. */
function scoreDemo(rows: { rowIndex: number; f: RowFindings }[]): Scored {
  const s: Scored = { flagged: {}, correct: {}, missed: {}, cleanFlagged: 0, cleanRows: 0, rightSuggestion: 0, needSuggestion: 0 };
  const add = (m: Record<string, number>, k: string): void => { m[k] = (m[k] ?? 0) + 1; };
  for (const { rowIndex, f } of rows) {
    const label = demoLabels[rowIndex];
    if (!label) continue;
    const expected = label.intent === 'clean' ? null : EXPECTED[label.intent];
    if (label.intent === 'clean') {
      s.cleanRows++;
      if (f.types.length > 0) s.cleanFlagged++;
    }
    for (const t of f.types) {
      add(s.flagged, t);
      if (t === expected) add(s.correct, t);
    }
    if (expected && !f.types.includes(expected)) add(s.missed, expected);
    if (label.intent === 'missing' || label.intent === 'not_found' || label.intent === 'wrong_code') {
      s.needSuggestion++;
      if (f.suggested === label.correctCode) s.rightSuggestion++;
    }
  }
  return s;
}

const count = (rows: RowFindings[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of rows) for (const t of r.types) out[t] = (out[t] ?? 0) + 1;
  return out;
};

async function reaudit(orgId: string, items: (AuditableItem & { key: string })[]): Promise<Map<string, RowFindings>> {
  const ctx = await auditContext(orgId);
  const out = new Map<string, RowFindings>();
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (;;) {
      const item = items[next++];
      if (!item) return;
      const { findings } = await checkItem(item, ctx);
      const top = findings.find((f) => f.suggestedMxik);
      out.set(item.key, {
        types: [...new Set(findings.map((f) => f.type).filter((t) => ENGINE_TYPES.has(t)))].sort(),
        suggested: top?.suggestedMxik ?? null,
        band: top?.confidence === null || top?.confidence === undefined ? null : bandOf(top.confidence),
      });
    }
  }));
  return out;
}

const report: unknown[] = [];

// ---------------------------------------------------------- stored catalogues
const chosen = values('--catalog');
const catalogs = await db.catalog.findMany({
  where: chosen.length > 0 ? { id: { in: chosen } } : { status: 'ready', org: { kind: { in: ['customer', 'demo_template'] } } },
  orderBy: { createdAt: 'asc' },
  include: { org: { select: { kind: true } } },
});
for (const catalog of catalogs) {
  const items = await db.catalogItem.findMany({
    where: { catalogId: catalog.id },
    orderBy: { rowIndex: 'asc' },
    select: { id: true, rowIndex: true, rawName: true, barcode: true, existingMxik: true, unit: true, findings: { select: { type: true, suggestedMxik: true, confidence: true } } },
  });
  if (items.length < 20) continue; // the 2- to 4-row test uploads say nothing
  const t0 = Date.now();
  const fresh = await reaudit(catalog.orgId, items.map((i) => ({ ...i, key: i.id })));
  const stored = new Map(items.map((i) => {
    const top = i.findings.find((f) => f.suggestedMxik);
    return [i.id, {
      types: [...new Set(i.findings.map((f) => f.type).filter((t) => ENGINE_TYPES.has(t)))].sort(),
      suggested: top?.suggestedMxik ?? null,
      band: top?.confidence === null || top?.confidence === undefined ? null : bandOf(top.confidence),
    }];
  }));
  const transitions: Record<string, number> = {};
  const newMismatch: string[] = [];
  let suggestionChanged = 0;
  for (const i of items) {
    const before = stored.get(i.id) as RowFindings;
    const after = fresh.get(i.id) as RowFindings;
    const k = `${before.types.join('+') || 'none'} -> ${after.types.join('+') || 'none'}`;
    if (before.types.join() !== after.types.join()) transitions[k] = (transitions[k] ?? 0) + 1;
    if (after.types.includes('MISMATCH') && !before.types.includes('MISMATCH')) newMismatch.push(`row ${i.rowIndex} "${i.rawName.slice(0, 60)}" own ${i.existingMxik} -> ${after.suggested}`);
    if (before.suggested !== after.suggested) suggestionChanged++;
  }
  const isDemo = catalog.org.kind === 'demo_template';
  const entry = {
    catalog: catalog.id, filename: catalog.filename, orgKind: catalog.org.kind, rows: items.length, uploadedAt: catalog.createdAt,
    stored: count([...stored.values()]), fresh: count([...fresh.values()]),
    rowsWhoseTypesChanged: Object.values(transitions).reduce((a, b) => a + b, 0), transitions, newMismatch, suggestionChanged,
    ...(isDemo ? {
      demoQuality: {
        stored: scoreDemo(items.map((i) => ({ rowIndex: i.rowIndex, f: stored.get(i.id) as RowFindings }))),
        fresh: scoreDemo(items.map((i) => ({ rowIndex: i.rowIndex, f: fresh.get(i.id) as RowFindings }))),
      },
    } : {}),
  };
  report.push(entry);
  console.log(`\n${catalog.filename} (${catalog.org.kind}, ${items.length} rows, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  console.log(`  stored ${JSON.stringify(entry.stored)}`);
  console.log(`  fresh  ${JSON.stringify(entry.fresh)}`);
  console.log(`  rows whose finding types changed: ${entry.rowsWhoseTypesChanged}; suggestion changed on ${suggestionChanged}`);
  for (const [k, v] of Object.entries(transitions)) console.log(`    ${String(v).padStart(3)}  ${k}`);
  for (const m of newMismatch) console.log(`  NEW MISMATCH ${m}`);
  if (entry.demoQuality) {
    for (const side of ['stored', 'fresh'] as const) {
      const q = entry.demoQuality[side];
      const per = Object.keys(EXPECTED).map((intent) => EXPECTED[intent as keyof typeof EXPECTED])
        .map((t) => `${t} ${q.correct[t] ?? 0}/${q.flagged[t] ?? 0} (missed ${q.missed[t] ?? 0})`).join(', ');
      console.log(`  demo labels, ${side}: ${per}; clean rows flagged ${q.cleanFlagged}/${q.cleanRows}; right suggestion ${q.rightSuggestion}/${q.needSuggestion}`);
    }
  }
}

// ------------------------------------------------------------ eval CSV rows
for (const file of values('--csv')) {
  const { cases } = parseCases(readFileSync(file, 'utf8'), file);
  const orgId = (await db.organization.findFirst({ where: { kind: 'customer' }, select: { id: true } }))?.id;
  if (!orgId) throw new Error('no customer organisation to borrow a (read-only) audit context from');
  const fresh = await reaudit(orgId, cases.map((c) => ({ key: c.id, rawName: c.name, barcode: c.barcode, existingMxik: null, unit: c.unit })));
  const rows = [...fresh.values()];
  const bands: Record<string, number> = {};
  for (const r of rows) bands[r.band ?? 'none'] = (bands[r.band ?? 'none'] ?? 0) + 1;
  const entry = { csv: file, rows: rows.length, fresh: count(rows), suggestionBands: bands };
  report.push(entry);
  console.log(`\n${file} (${rows.length} rows, no stored audit): ${JSON.stringify(entry.fresh)}; suggestion bands ${JSON.stringify(bands)}`);
}

const history = existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, 'utf8')) as { runs: unknown[] }) : { runs: [] };
history.runs.push({ label: LABEL, ranAt: new Date().toISOString(), database: new URL(process.env['DATABASE_URL'] ?? 'postgresql://x/mxik').pathname.slice(1), catalogues: report });
writeFileSync(RESULTS, JSON.stringify({ note: 'Append-only history of `npm run reaudit:diff` (plan §6): in-memory re-audits diffed against the stored audit; nothing is written to the catalogues.', runs: history.runs }, null, 2) + '\n');
console.log(`\nappended to ${RESULTS}`);
await db.$disconnect();
process.exit(0);
