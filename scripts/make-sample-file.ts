// Writes public/demo/namuna-katalog.xlsx from the demo's catalogue
// (prisma/demo-catalog.json, whose first rows are scripts/landing-sample/
// catalog.ts). No database needed.
//
// The landing page offers this file as a download, and the screenshot capture
// uploads it to photograph the column-mapping screen. It is the same catalogue
// the landing page's sample report and the demo were produced from;
// `npm run make:sample-report` writes it too, alongside the report.
// Run: npm run make:sample
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { SAMPLE_FILENAME, SAMPLE_HEADERS, sampleWorkbook } from './landing-sample/catalog.js';

const OUT_DIR = 'public/demo';
const rows = (JSON.parse(readFileSync('prisma/demo-catalog.json', 'utf8')) as { rows: string[][] }).rows;

await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/${SAMPLE_FILENAME}`, await sampleWorkbook(rows));

console.log(`wrote ${OUT_DIR}/${SAMPLE_FILENAME}`);
console.log(`  headers: ${SAMPLE_HEADERS.join(' | ')}`);
console.log(`  rows:    ${rows.length}`);
