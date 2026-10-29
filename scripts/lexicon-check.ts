// Regression check for the learned lexicon (docs/MATCHING_V2_PLAN.md §11, DEPLOY.md "Lexicon
// approvals"): runs the five-file bench and the eval sets with the database lexicon applied (as the
// audit applies it) and compares them with the last recorded runs in docs/bench-results.json and
// docs/eval-results.json. Any drop fails the check; gains are listed too. Neither history file is
// touched: the runs are written to tmp/lexicon-check/.
//
//   npm run lexicon:check [-- --bench-only | --eval-only] [--set competitor-22]
//
// The reranker is forced off (the recorded baselines ran without one; a key in .env would also
// burn the free-tier quota). Run it on the database the audit uses, before approving aliases or
// adding entries in bulk, and again after: a drop against the baseline means an entry pulls rows
// the wrong way and should be disabled.
import '@tasnivo/domain/load-env';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BENCH_HISTORY = 'docs/bench-results.json';
const EVAL_HISTORY = 'docs/eval-results.json';
const OUT_DIR = 'tmp/lexicon-check';
const BENCH_ONLY = process.argv.includes('--bench-only');
const EVAL_ONLY = process.argv.includes('--eval-only');
const extraEvalArgs = process.argv.flatMap((a, i) => (process.argv[i - 1] === '--set' ? ['--set', a] : []));

type TypeScore = { expected: number; got: number; tp: number; precision: number | null; recall: number | null };
type FileScore = { top1: { n: number; hit: number }; fix: { n: number; hit: number }; rowsExact: number; audited: number; byType: Record<string, TypeScore> };
type BenchRun = { label: string; ranAt: string; code: string; files: Record<string, FileScore>; total: FileScore };
type SetMetrics = { n: number; top1: number; top5: number; highPrecisionPct: number | null; ceilingPct: number | null };
type EvalRun = { label: string; ranAt: string; code: string; metricsBySet: Record<string, Record<string, SetMetrics>> };

type Line = { name: string; metric: string; before: number | null; after: number | null };

const fmt = (v: number | null): string => (v === null ? '-' : Number.isInteger(v) ? String(v) : v.toFixed(1));

function run(script: string, args: string[]): void {
  const command = `npm run ${script} -- ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`;
  console.log(`\n$ ${command}`);
  const result = spawnSync(command, { stdio: 'inherit', shell: true, env: { ...process.env, RERANK_PROVIDER: 'off' } });
  if (result.status !== 0) {
    console.error(`${script} failed (exit ${result.status ?? 'signal'})`);
    process.exit(result.status ?? 1);
  }
}

function lastRun<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  const history = JSON.parse(readFileSync(file, 'utf8')) as { runs: T[] };
  return history.runs[history.runs.length - 1] ?? null;
}

/** The lines where before and after differ, per file and per metric; a lower "after" is a drop. */
function compareBench(before: BenchRun, after: BenchRun): Line[] {
  const lines: Line[] = [];
  const files = [...new Set([...Object.keys(before.files), ...Object.keys(after.files)]), 'TOTAL'];
  for (const file of files) {
    const b = file === 'TOTAL' ? before.total : before.files[file];
    const a = file === 'TOTAL' ? after.total : after.files[file];
    if (!b || !a) { lines.push({ name: file, metric: 'present', before: b ? 1 : 0, after: a ? 1 : 0 }); continue; }
    const pairs: [string, number | null, number | null][] = [
      ['top-1 hits', b.top1.hit, a.top1.hit], ['fix hits', b.fix.hit, a.fix.hit], ['rows exact', b.rowsExact, a.rowsExact],
    ];
    for (const type of new Set([...Object.keys(b.byType), ...Object.keys(a.byType)])) {
      pairs.push([`${type} precision`, b.byType[type]?.precision ?? null, a.byType[type]?.precision ?? null]);
      pairs.push([`${type} recall`, b.byType[type]?.recall ?? null, a.byType[type]?.recall ?? null]);
    }
    for (const [metric, x, y] of pairs) if (x !== y) lines.push({ name: file, metric, before: x, after: y });
  }
  return lines;
}

function compareEval(before: EvalRun, after: EvalRun): Line[] {
  const lines: Line[] = [];
  const b = before.metricsBySet['full'] ?? {};
  const a = after.metricsBySet['full'] ?? {};
  for (const set of new Set([...Object.keys(b), ...Object.keys(a)])) {
    const x = b[set];
    const y = a[set];
    if (!x || !y) { lines.push({ name: set, metric: 'present', before: x ? 1 : 0, after: y ? 1 : 0 }); continue; }
    const pairs: [string, number | null, number | null][] = [
      ['top-1', x.top1, y.top1], ['top-5', x.top5, y.top5], ['high precision %', x.highPrecisionPct, y.highPrecisionPct], ['pool %', x.ceilingPct, y.ceilingPct],
    ];
    for (const [metric, p, q] of pairs) if (p !== q) lines.push({ name: set, metric, before: p, after: q });
  }
  return lines;
}

function report(title: string, baseline: { label: string; ranAt: string; code: string }, lines: Line[]): boolean {
  console.log('');
  console.log(`${title} — baseline "${baseline.label}" (${baseline.code}, ${baseline.ranAt.slice(0, 10)})`);
  if (lines.length === 0) {
    console.log('  unchanged');
    return true;
  }
  const drops = lines.filter((l) => (l.after ?? -1) < (l.before ?? -1));
  for (const l of lines) {
    const drop = (l.after ?? -1) < (l.before ?? -1);
    console.log(`  ${drop ? 'DROP' : 'gain'}  ${l.name.padEnd(32)} ${l.metric.padEnd(24)} ${fmt(l.before).padStart(6)} -> ${fmt(l.after)}`);
  }
  return drops.length === 0;
}

mkdirSync(OUT_DIR, { recursive: true });
let ok = true;

if (!EVAL_ONLY) {
  const baseline = lastRun<BenchRun>(BENCH_HISTORY);
  if (!baseline) {
    console.error(`${BENCH_HISTORY}: no recorded run to compare with`);
    process.exit(1);
  }
  const out = join(OUT_DIR, 'bench.json');
  run('bench:files', ['--no-append', '--out', out, '--label', 'lexicon:check']);
  ok = report('bench:files', baseline, compareBench(baseline, JSON.parse(readFileSync(out, 'utf8')) as BenchRun)) && ok;
}

if (!BENCH_ONLY) {
  const baseline = lastRun<EvalRun>(EVAL_HISTORY);
  if (!baseline) {
    console.error(`${EVAL_HISTORY}: no recorded run to compare with`);
    process.exit(1);
  }
  const out = join(OUT_DIR, 'eval.json');
  run('eval', ['--no-ablate', '--no-append', '--out', out, '--label', 'lexicon:check', ...extraEvalArgs]);
  ok = report('eval', baseline, compareEval(baseline, JSON.parse(readFileSync(out, 'utf8')) as EvalRun)) && ok;
}

console.log('');
console.log(ok ? 'lexicon:check OK — nothing dropped against the recorded baselines.' : 'lexicon:check FAILED — a metric dropped; disable the entry that caused it before approving more.');
process.exit(ok ? 0 : 1);
