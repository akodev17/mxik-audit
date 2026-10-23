// Bank statement benchmark (docs/accounting-2026-10-23/benchmarks.md, section "Bank"): a generated
// 1 000-line statement (RU layout, title block, totals and balances) through every stage —
// read the xlsx, parse and normalise, then match (the onec interface), rules, duplicates and
// writing the records in chunks of 500 — against the development database, in a throwaway org.
//
//   npx tsx scripts/bench-bank.ts [lines=1000] [runs=3]
//
// The AI suggester is off (no network in a benchmark); with a key it adds at most four calls.
import ExcelJS from 'exceljs';
import { db } from '@tasnivo/db';
import { setOperationSuggester } from '@tasnivo/domain/bank/ai';
import { readLines, readStatementFile } from '@tasnivo/domain/bank/read';
import { processStatement } from '@tasnivo/domain/bank/store';
import { dropOrgs, makeOrg } from '@tasnivo/domain/test-fixtures';

const LINES = Number(process.argv[2] ?? 1000);
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

setOperationSuggester(null);
const org = await makeOrg();
try {
  const results: Record<string, number>[] = [];
  for (let r = 0; r < RUNS; r++) results.push(await run(r + 1, org.orgId));
  const keys = Object.keys(results[0] ?? {});
  const median = (k: string): number => {
    const v = results.map((x) => x[k] ?? 0).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)] ?? 0;
  };
  console.log(`bank benchmark: ${LINES} lines, ${RUNS} runs (ms; median, then each run)`);
  for (const k of keys) console.log(`${k.padEnd(16)} ${String(median(k)).padStart(9)}   ${results.map((x) => x[k]).join(' / ')}`);
} finally {
  await dropOrgs([org.orgId]);
  await db.$disconnect();
}
