// Writes public/demo/namuna-katalog.xlsx from the seeded demo catalogue.
//
// Two uses: the landing page offers it as a sample download so a visitor can see
// the expected shape, and the screenshot capture uploads it to photograph the
// real column-mapping screen.
// Run: npm run make:sample
import '../src/lib/load-env.js';
import { mkdir, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { db } from '../src/lib/db.js';

const OUT_DIR = 'public/demo';
const OUT_FILE = `${OUT_DIR}/namuna-katalog.xlsx`;

const catalog = await db.catalog.findFirst({
  where: { status: 'ready' },
  orderBy: { createdAt: 'desc' },
});
if (!catalog) throw new Error('No audited catalogue found. Run npm run seed && npm run seed:audit first.');

const items = await db.catalogItem.findMany({
  where: { catalogId: catalog.id },
  orderBy: { rowIndex: 'asc' },
  select: { attrs: true },
});

const workbook = new ExcelJS.Workbook();
workbook.creator = 'MXIK Audit — namuna';
const sheet = workbook.addWorksheet('Katalog');

sheet.addRow(catalog.headers);
const header = sheet.getRow(1);
header.font = { bold: true };

let written = 0;
for (const item of items) {
  const attrs = item.attrs as { original?: unknown };
  if (!Array.isArray(attrs.original)) continue;
  sheet.addRow(attrs.original.map((c) => (typeof c === 'string' ? c : '')));
  written++;
}

// The MXIK column holds 17-digit codes; without text format Excel shows 1.7E+16.
const mxikCol = (catalog.columnMap as { mxik: number }).mxik;
if (mxikCol >= 0) {
  sheet.getColumn(mxikCol + 1).numFmt = '@';
  sheet.getColumn(mxikCol + 1).width = 20;
}
sheet.getColumn(2).width = 52;
sheet.views = [{ state: 'frozen', ySplit: 1 }];

await mkdir(OUT_DIR, { recursive: true });
const buffer = await workbook.xlsx.writeBuffer();
await writeFile(OUT_FILE, Buffer.from(buffer));

console.log(`wrote ${OUT_FILE}`);
console.log(`  headers: ${catalog.headers.join(' | ')}`);
console.log(`  rows:    ${written}`);
await db.$disconnect();
