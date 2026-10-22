// Loads the official list of generalized codes EHF refuses (perechen.xlsx,
// layout in src/lib/restricted-list.ts) into restricted_code, which feeds the
// RESTRICTED finding. Upserts, so a later stage's list adds codes and a
// re-run updates dates; codes absent from the file are left alone.
// Run: npm run load:restricted -- <xlsx> [--from 2026-07-01] [--source <url>]
import '../src/lib/load-env.js'; // must precede anything reading process.env
import ExcelJS from 'exceljs';
import { db } from '../src/lib/db.js';
import { parseRestrictedSheet, RESTRICTED_DEFAULT_FROM, RESTRICTED_SOURCE_URL } from '../src/lib/restricted-list.js';

const args = process.argv.slice(2);
const option = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!file) {
  console.error('usage: npm run load:restricted -- <xlsx> [--from YYYY-MM-DD] [--source <url>]');
  process.exit(1);
}
const from = option('--from') ?? RESTRICTED_DEFAULT_FROM;
if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error(`--from must be YYYY-MM-DD, got ${from}`);
const effectiveFrom = new Date(`${from}T00:00:00Z`);
const source = option('--source') ?? RESTRICTED_SOURCE_URL;

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(file);
const sheet = workbook.worksheets[0];
if (!sheet) throw new Error(`${file}: no worksheet`);
const { entries, skipped, duplicates } = parseRestrictedSheet(sheet);
if (entries.length === 0) throw new Error(`${file}: no codes found (expected the official layout, header "МХИК коди")`);

const before = new Set((await db.restrictedCode.findMany({ select: { code: true } })).map((r) => r.code));
const importedAt = new Date();
await db.$transaction(entries.map((e) => db.restrictedCode.upsert({
  where: { code: e.code },
  create: { code: e.code, effectiveFrom, reason: e.name, source, importedAt },
  update: { effectiveFrom, reason: e.name, source, importedAt },
})));

const codes = entries.map((e) => e.code);
const known = await db.$queryRaw<{ code: string; retired: boolean }[]>`
  SELECT code, "retiredAt" IS NOT NULL AS retired FROM mxik_code WHERE code = ANY(${codes}::char(17)[])`;
const added = codes.filter((c) => !before.has(c)).length;
console.log(`${file}: ${entries.length} codes from ${from} (${source})`);
console.log(`  added ${added}, updated ${entries.length - added}, table now ${await db.restrictedCode.count()}`);
console.log(`  in the classifier: ${known.length} (retired ${known.filter((k) => k.retired).length}), not in it: ${entries.length - known.length}`);
if (duplicates.length > 0) console.log(`  listed twice, kept once: ${duplicates.join(', ')}`);
for (const s of skipped) console.log(`  row ${s.row} skipped, not a 17-digit code: "${s.value}"`);
await db.$disconnect();
