// Bank statement benchmark (docs/accounting-2026-10-23/benchmarks.md, section "Bank"): a generated
// 1 000-line statement (RU layout, title block, totals and balances) through every stage —
// read the xlsx, parse and normalise, then match (the onec interface), rules, duplicates and
// writing the records in chunks of 500 — against the development database, in a throwaway org.
//
//   npx tsx scripts/bench-bank.ts [lines=1000] [runs=3]
//   npx tsx scripts/bench-bank.ts --fixtures [runs=3]
//
// --fixtures reads every real-material fixture of the 30 Oct research instead (bank/fixtures:
// the documented layouts; onec/fixtures/bank-input: the ten real kl_to_1c files) through the same
// stages and prints, per file, the lines read and the median times.
//
// The AI suggester is off (no network in a benchmark); with a key it adds at most four calls.
import { readFileSync, readdirSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { db } from '@tasnivo/db';
import { setOperationSuggester } from '@tasnivo/domain/bank/ai';
import { readLines, readStatementFile } from '@tasnivo/domain/bank/read';
import { processStatement } from '@tasnivo/domain/bank/store';
import { dropOrgs, makeOrg } from '@tasnivo/domain/test-fixtures';

const FIXTURES = process.argv[2] === '--fixtures';
const LINES = FIXTURES ? 0 : Number(process.argv[2] ?? 1000);
const RUNS = Number(process.argv[3] ?? 3);

const PURPOSES = [
  'Оплата за товар по договору № 4/28 от 01.01.2026г, в т.ч. НДС 12%',
  'Оплата за услуги по счету №45, без НДС',
  'Комиссия за обслуживание счета',
  'SmartVista - Выручка по терминалу 12345678',
  'Уплата НДС за сентябрь 2026 года',
  'Перечисление заработной платы по реестру №9',
  'Возврат излишне перечисленных средств',
];

async function statement(n: number, seed: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Выписка');
  ws.addRow([`АКБ «Намуна Банк» (бенчмарк ${seed})`]);
  ws.addRow(['ВЫПИСКА ЛИЦЕВОГО СЧЕТА за период с 01.10.2026 по 31.10.2026']);
  ws.addRow(['ИНН: 301234567']);
  ws.addRow(['Счет: 20208000900123456001']);
  ws.addRow(['Входящий остаток: 1 000 000 000,00']);
  ws.addRow(['Дата', '№ док.', 'Корреспондент', 'ИНН', 'Счёт', 'МФО', 'Дебет', 'Кредит', 'Назначение платежа']);
  let debit = 0n;
  let credit = 0n;
  for (let i = 0; i < n; i++) {
    const tiyin = BigInt(10_000 + ((i * 7919 + seed) % 5_000_000));
    const isCredit = i % 3 === 0;
    if (isCredit) credit += tiyin; else debit += tiyin;
    const amount = `${(tiyin / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${(tiyin % 100n).toString().padStart(2, '0')}`;
    const inn = String(300_000_000 + (i % 250));
    ws.addRow([
      `${String((i % 28) + 1).padStart(2, '0')}.10.2026`, String(1000 + i), i % 7 === 2 ? '' : `ООО «Контрагент ${i % 250}»`, i % 7 === 2 ? '000000000' : inn,
      `2020800050${String(i % 250).padStart(10, '0')}`, '00440', isCredit ? '0,00' : amount, isCredit ? amount : '0,00', PURPOSES[i % PURPOSES.length] ?? '',
    ]);
  }
  const fmt = (v: bigint): string => `${(v / 100n).toString()},${(v % 100n).toString().padStart(2, '0')}`;
  ws.addRow(['Итого обороты:', '', '', '', '', '', fmt(debit), fmt(credit), '']);
  ws.addRow(['Исходящий остаток:', '', '', '', '', '', '', fmt(100_000_000_000n + credit - debit), '']);
  for (const c of [4, 5, 6]) ws.getColumn(c).numFmt = '@';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const ms = (start: number): number => Math.round((performance.now() - start) * 10) / 10;

async function run(seed: number, orgId: string): Promise<Record<string, number>> {
  const bytes = await statement(LINES, seed);
  const t: Record<string, number> = {};
  let start = performance.now();
  const file = await readStatementFile(bytes);
  t['read_xlsx'] = ms(start);
  if (!file.builtIn) throw new Error('layout not recognised');
  start = performance.now();
  const parsed = readLines(file, file.builtIn.layout);
  t['parse_normalise'] = ms(start);
  if (parsed.lines.length !== LINES) throw new Error(`read ${parsed.lines.length} lines`);
  const batch = await db.importBatch.create({ data: { orgId, kind: 'bank_statement', source: 'upload', filename: `bench-${seed}.xlsx`, fingerprint: file.fingerprint }, select: { id: true } });
  const timings: Record<string, number> = {};
  start = performance.now();
  await processStatement({ batchId: batch.id, orgId, clientId: null, parsed, suggester: null, timings });
  t['process_total'] = ms(start);
  for (const [k, v] of Object.entries(timings)) t[k] = Math.round(v * 10) / 10;
  const after = await db.importBatch.findUnique({ where: { id: batch.id }, select: { status: true } });
  if (after?.status !== 'review') throw new Error(`batch ended ${after?.status}`);
  t['records'] = await db.importRecord.count({ where: { batchId: batch.id } });
  t['end_to_end'] = Math.round((t['read_xlsx'] + t['parse_normalise'] + t['process_total']) * 10) / 10;
  return t;
}

/** One fixture through read, parse and processing; the batch is dropped with the org. */
async function runFile(name: string, bytes: Buffer, orgId: string, seed: number): Promise<Record<string, number>> {
  const t: Record<string, number> = {};
  let start = performance.now();
  const file = await readStatementFile(bytes);
  t['read'] = ms(start);
  if (!file.builtIn) throw new Error(`${name}: layout not recognised`);
  start = performance.now();
  const parsed = readLines(file, file.builtIn.layout);
  t['parse'] = ms(start);
  const batch = await db.importBatch.create({ data: { orgId, kind: 'bank_statement', source: 'upload', filename: name, fingerprint: `bench-${seed}-${name}` }, select: { id: true } });
  start = performance.now();
  await processStatement({ batchId: batch.id, orgId, clientId: null, parsed, suggester: null });
  t['process'] = ms(start);
  const after = await db.importBatch.findUnique({ where: { id: batch.id }, select: { status: true } });
  if (after?.status !== 'review') throw new Error(`${name}: batch ended ${after?.status}`);
  t['lines'] = parsed.lines.length;
  return t;
}

async function fixtures(orgId: string): Promise<void> {
  const dirs = [new URL('../packages/domain/src/bank/fixtures/', import.meta.url), new URL('../packages/domain/src/onec/fixtures/bank-input/', import.meta.url)];
  const files = dirs.flatMap((dir) => readdirSync(dir).filter((n) => /\.(xlsx|xls|zip|csv|txt)$/.test(n) && !/^(ru|uz)-debit|^amount-direction|^signed-1251/.test(n)).map((n) => ({ name: n, bytes: readFileSync(new URL(n, dir)) })));
  console.log(`bank benchmark on the real-material fixtures, ${RUNS} runs (ms, median)`);
  console.log(`${'file'.padEnd(46)} ${'lines'.padStart(5)} ${'read'.padStart(7)} ${'parse'.padStart(7)} ${'process'.padStart(8)}`);
  for (const f of files) {
    const runs: Record<string, number>[] = [];
    for (let r = 0; r < RUNS; r++) runs.push(await runFile(f.name, f.bytes, orgId, r));
    const median = (k: string): number => runs.map((x) => x[k] ?? 0).sort((a, b) => a - b)[Math.floor(runs.length / 2)] ?? 0;
    console.log(`${f.name.padEnd(46)} ${String(median('lines')).padStart(5)} ${String(median('read')).padStart(7)} ${String(median('parse')).padStart(7)} ${String(median('process')).padStart(8)}`);
  }
}

async function generated(orgId: string): Promise<void> {
  const results: Record<string, number>[] = [];
  for (let r = 0; r < RUNS; r++) results.push(await run(r + 1, orgId));
  const keys = Object.keys(results[0] ?? {});
  const median = (k: string): number => {
    const v = results.map((x) => x[k] ?? 0).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)] ?? 0;
  };
  console.log(`bank benchmark: ${LINES} lines, ${RUNS} runs (ms; median, then each run)`);
  for (const k of keys) console.log(`${k.padEnd(16)} ${String(median(k)).padStart(9)}   ${results.map((x) => x[k]).join(' / ')}`);
}

setOperationSuggester(null);
const org = await makeOrg();
try {
  await (FIXTURES ? fixtures(org.orgId) : generated(org.orgId));
} finally {
  await dropOrgs([org.orgId]);
  await db.$disconnect();
}
