// Writes public/demo/namuna-katalog.xlsx from the landing page's sample
// catalogue (scripts/landing-sample/catalog.ts). No database needed.
//
// The landing page offers this file as a download, and the screenshot capture
// uploads it to photograph the column-mapping screen. It is the same file the
// landing page's sample report was produced from; `npm run make:sample-report`
// writes it too, alongside the report.
// Run: npm run make:sample
import { mkdir, writeFile } from 'node:fs/promises';
import { SAMPLE_FILENAME, SAMPLE_HEADERS, SAMPLE_ROWS, sampleWorkbook } from './landing-sample/catalog.js';

const OUT_DIR = 'public/demo';

await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/${SAMPLE_FILENAME}`, await sampleWorkbook());

console.log(`wrote ${OUT_DIR}/${SAMPLE_FILENAME}`);
console.log(`  headers: ${SAMPLE_HEADERS.join(' | ')}`);
console.log(`  rows:    ${SAMPLE_ROWS.length}`);
