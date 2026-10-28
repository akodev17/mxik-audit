// Benchmark on test catalogues with answer keys (docs/BENCHMARK_KRAFTA.md): each xlsx is read by
// the upload's own reader, mapped by the header guess, and every row goes through the audit's
// per-row check (checkItem: matching plus every check) in memory against the classifier DB.
// Nothing is stored: no catalogue, no findings, no rerank cache rows. The "Javob kaliti" sheet
// says what each row should get; the score per file is precision/recall per finding type, top-1
// for rows without a code, the fix rate for wrong or unknown codes, and the import diagnostics.
// Each run is appended to docs/bench-results.json.
//
//   npm run bench:files [-- --file test-dorixona.xlsx --dir tmp/found-catalogs --label "..." --rerank --no-append]
//
// --rerank uses the reranker the environment configures (a key is needed; verdicts cached in
// memory only); without it stage 6 is off, as on a server without a key.
import '@tasnivo/domain/load-env'; // must precede anything reading process.env
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import ExcelJS from 'exceljs';
import { NoopRerankProvider, rerankFromEnv } from '@tasnivo/core/match/rerank';
import { MemoryRerankCache } from '@tasnivo/core/match/rerank-cache';
import { lexicalStrictThresholdFromEnv, PostgresCandidateStore } from '@tasnivo/core/match/store';
import type { DisableableStage } from '@tasnivo/core/match/pipeline';
import { db } from '@tasnivo/db';
import {
  checkItem, classifierPool, closeClassifierPool, loadRestricted, vectorReadiness, type AuditableItem, type AuditContext,
} from '@tasnivo/domain/audit-runner';
import { readCode } from '@tasnivo/core/audit/checks';
import { guessMapping } from '@tasnivo/domain/catalog-import';
import { importDiagnostics } from '@tasnivo/domain/import-diagnostics';
import { parseUpload } from '@tasnivo/domain/spreadsheet';
import { runPool } from '@tasnivo/domain/work-pool';
import {
  parseKey, SCORED_TYPES, scoreFile, totalScore, type FileScore, type RowResult, type TypeScore,
} from '../eval/bench-score.js';

const RESULTS = 'docs/bench-results.json';
const KEY_SHEET = 'Javob kaliti';
const CONCURRENCY = 6;

const argValue = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DIR = argValue('--dir') ?? 'tmp/found-catalogs';
const ONLY = argValue('--file');
const LABEL = argValue('--label') ?? 'bench:files';
const RERANK = process.argv.includes('--rerank');
const APPEND = !process.argv.includes('--no-append');

/** The five catalogues of MATCHING_V2_PLAN T3, in the order the doc lists them. */
const DEFAULT_FILES = [
  'test-oziq-ovqat-2.xlsx', 'test-stroymarket-2.xlsx', 'test-dorixona.xlsx', 'test-elektronika.xlsx', 'test-umumiy-ovqatlanish.xlsx',
];

function filesToRun(): string[] {
  if (ONLY) return [existsSync(ONLY) ? ONLY : join(DIR, ONLY)];
  const present = existsSync(DIR) ? readdirSync(DIR) : [];
  const missing = DEFAULT_FILES.filter((f) => !present.includes(f));
  if (missing.length > 0) {
    console.error(`missing in ${DIR}: ${missing.join(', ')} (build them with \`npx tsx tmp/build-five.mjs\`, see docs/BENCHMARK_KRAFTA.md)`);
    process.exit(1);
  }
  return DEFAULT_FILES.map((f) => join(DIR, f));
}

async function readKey(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet(KEY_SHEET);
  if (!sheet) throw new Error(`no "${KEY_SHEET}" sheet`);
  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    grid.push(Array.from({ length: sheet.columnCount }, (_, i) => row.getCell(i + 1).text ?? ''));
  });
  return grid;
}

/** Everything the per-row check needs, set up as auditContext does but with nothing persisted. */
async function benchContext(): Promise<AuditContext> {
  const { reranker: envReranker, gate } = rerankFromEnv(process.env, new MemoryRerankCache());
  const reranker = RERANK ? envReranker : new NoopRerankProvider('bench:files');
  const readiness = await vectorReadiness();
  const embedder = readiness.embedder;
  const store = new PostgresCandidateStore(classifierPool(), {
    exactVectorScan: !embedder.semantic,
    vectorEnabled: readiness.usable,
    lexicalStrictThreshold: lexicalStrictThresholdFromEnv(process.env),
  });
  const degradedReasons: string[] = [];
  if (!reranker.available) degradedReasons.push(RERANK ? 'reranker unavailable (no key?)' : 'reranker off (run with --rerank)');
  if (!embedder.semantic) degradedReasons.push(`vector stage not semantic (${embedder.name})`);
  if (!readiness.usable) degradedReasons.push(`vector stage off: ${readiness.reason ?? 'unusable'}`);
  const disabledStages = readiness.usable ? undefined : new Set<DisableableStage>(['vector']);
  return {
    store, embedder, reranker, gate, disabledStages, vectorColumns: readiness.stored?.columns,
    degradedReasons, restricted: await loadRestricted(),
  };
}

type FileRun = { file: string; score: FileScore; seconds: number; misses: string[] };

async function benchFile(path: string, ctx: AuditContext): Promise<FileRun> {
  const t0 = Date.now();
  const buffer = readFileSync(path);
  const parsed = await parseUpload(buffer, basename(path));
  const mapping = guessMapping(parsed.headers);
  const key = await readKey(buffer).then(parseKey);
  if (key.length !== parsed.rows.length) throw new Error(`${path}: ${parsed.rows.length} data rows but ${key.length} answer-key rows`);
  // The TN VED column, when this build's mapping knows one (the TN VED branch); main ignores it.
  const tnvedAt = (mapping as Record<string, number | undefined>)['tnved'];

  const cell = (row: readonly string[], index: number): string | null => {
    const value = index < 0 ? undefined : row[index]?.trim();
    return value ? value : null;
  };
  const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const rows = parsed.rows.map((row, i) => {
    const excelRow = parsed.meta.headerRow + 1 + i;
    const keyRow = key[i];
    const rawName = cell(row, mapping.name) ?? '';
    if (!keyRow || keyRow.excelRow !== excelRow || squash(keyRow.name) !== squash(rawName)) {
      throw new Error(`${path}: row ${excelRow} "${rawName}" does not line up with answer-key row ${keyRow?.excelRow} "${keyRow?.name}"`);
    }
    const item: AuditableItem & { tnved?: string | null } = {
      rawName,
      barcode: cell(row, mapping.barcode),
      existingMxik: readCode(cell(row, mapping.mxik)), // as deriveItem stores it
      unit: cell(row, mapping.unit),
      ...(tnvedAt !== undefined && tnvedAt >= 0 ? { tnved: cell(row, tnvedAt) } : {}),
    };
    return { excelRow, item };
  }).filter((r) => r.item.rawName !== ''); // nameless rows are not imported

  const results = new Map<number, RowResult>();
  await runPool(rows, CONCURRENCY, async ({ excelRow, item }) => {
    const check = await checkItem(item, ctx);
    results.set(excelRow, { excelRow, types: check.findings.map((f) => f.type), top1: check.suggestions[0]?.candidate.code ?? null });
  });

  const diagnostics = importDiagnostics(parsed.rows, mapping);
  const score = scoreFile(key, results, { duplicates: diagnostics.duplicates.count, noName: diagnostics.noName.count });
  // The rows the key and the audit disagree on, for reading the numbers.
  const misses = key.filter((k) => k.importFlag !== 'nomsiz').flatMap((k) => {
    const r = results.get(k.excelRow);
    const got = (r?.types ?? []).filter((t) => (SCORED_TYPES as readonly string[]).includes(t)).sort();
    const want = [...k.expected].sort();
    const topWrong = k.want.length > 0 && !k.expected.includes('RESTRICTED') && (k.expected.includes('MISSING') || k.expected.includes('NOT_FOUND') || k.expected.includes('MISMATCH'))
      && !(r?.top1 && k.want.some((w) => (w.endsWith('*') ? r.top1?.startsWith(w.slice(0, -1)) : w === r.top1)));
    if (got.join() === want.join() && !topWrong) return [];
    return [`  ${String(k.excelRow).padStart(3)} ${k.kind.padEnd(22)} want ${want.join('+') || '-'}${k.want.length ? ` ${k.want.slice(0, 2).join('|')}${k.want.length > 2 ? '|…' : ''}` : ''}`
      + `  got ${got.join('+') || '-'} top1 ${r?.top1 ?? '-'}  "${k.name.slice(0, 50)}"`];
  });
  return { file: basename(path), score, seconds: (Date.now() - t0) / 1000, misses };
}

// --------------------------------------------------------------- report
const pct = (n: number | null): string => (n === null ? '    -' : `${n.toFixed(1).padStart(5)}`);
const typeLine = (t: string, s: TypeScore): string => `  ${t.padEnd(15)} ${String(s.expected).padStart(4)} ${String(s.got).padStart(5)} ${String(s.tp).padStart(4)}  ${pct(s.precision)}  ${pct(s.recall)}`;

function printFile(name: string, s: FileScore, seconds: number | null): void {
  console.log('');
  console.log(`${name}: ${s.rows} rows, ${s.audited} audited${seconds === null ? '' : `, ${seconds.toFixed(1)}s`}`);
  console.log('  type            want   got   tp  prec%   rec%');
  for (const t of SCORED_TYPES) {
    if (s.byType[t].expected > 0 || s.byType[t].got > 0) console.log(typeLine(t, s.byType[t]));
  }
  const other = Object.entries(s.unscored).map(([t, n]) => `${t} ${n}`).join(', ');
  if (other) console.log(`  not scored: ${other}`);
  console.log(`  top-1, rows without a code: ${s.top1.hit}/${s.top1.n} = ${pct(s.top1.pct).trim()}%  (right position ${s.top1.position}/${s.top1.n})`);
  console.log(`  fix, wrong or unknown code: ${s.fix.hit}/${s.fix.n} = ${pct(s.fix.pct).trim()}%  (right position ${s.fix.position}/${s.fix.n})`);
  console.log(`  import: duplicates ${s.imports.duplicates.got}/${s.imports.duplicates.expected}, nameless ${s.imports.noName.got}/${s.imports.noName.expected}`);
  console.log(`  rows with exactly the expected findings: ${s.rowsExact}/${s.audited}`);
}

const commit = (() => {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain -- packages eval scripts', { encoding: 'utf8' }).trim() !== '';
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return 'unknown';
  }
})();

const ctx = await benchContext();
console.log('='.repeat(78));
console.log(`bench:files — ${LABEL}`);
console.log('='.repeat(78));
console.log(`code        ${commit}`);
console.log(`embeddings  ${ctx.embedder.name}${ctx.embedder.semantic ? '' : '  <-- NOT SEMANTIC'}`);
console.log(`reranker    ${ctx.reranker.name}${ctx.reranker.available ? '' : '  <-- OFF'}`);
for (const reason of ctx.degradedReasons) console.log(`  degraded: ${reason}`);

const runs: FileRun[] = [];
for (const path of filesToRun()) {
  const run = await benchFile(path, ctx);
  runs.push(run);
  printFile(run.file, run.score, run.seconds);
  if (run.misses.length > 0) {
    console.log('  rows off the key:');
    for (const m of run.misses) console.log(m);
  }
}

const total = totalScore(runs.map((r) => r.score));
if (runs.length > 1) {
  printFile('TOTAL', total, null);
  console.log('');
  console.log('summary (prec/rec % per type; top-1 = rows without a code)');
  const heads = ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT', 'RESTRICTED'] as const;
  console.log(`  ${'file'.padEnd(30)} rows  ${heads.map((h) => h.slice(0, 11).padEnd(12)).join('')}top-1      fix`);
  for (const { file, score } of [...runs, { file: 'TOTAL', score: total }]) {
    const cells = heads.map((h) => {
      const t = score.byType[h];
      return (t.expected === 0 && t.got === 0 ? '-' : `${t.precision === null ? '-' : t.precision.toFixed(0)}/${t.recall === null ? '-' : t.recall.toFixed(0)}`).padEnd(12);
    }).join('');
    console.log(`  ${file.padEnd(30)} ${String(score.rows).padStart(4)}  ${cells}${`${score.top1.hit}/${score.top1.n}`.padEnd(11)}${score.fix.hit}/${score.fix.n}`);
  }
}

if (APPEND) {
  const history = existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, 'utf8')) as { runs: unknown[] }) : { runs: [] };
  history.runs.push({
    label: LABEL,
    ranAt: new Date().toISOString(),
    code: commit,
    providers: {
      embedding: ctx.embedder.name, embeddingSemantic: ctx.embedder.semantic,
      reranker: ctx.reranker.name, rerankerAvailable: ctx.reranker.available, degraded: ctx.degradedReasons,
    },
    files: Object.fromEntries(runs.map((r) => [r.file, { ...r.score, seconds: r.seconds }])),
    total,
  });
  writeFileSync(RESULTS, JSON.stringify(history, null, 2) + '\n');
  console.log(`\nappended run ${history.runs.length} to ${RESULTS}`);
}

await db.$disconnect();
await closeClassifierPool();
