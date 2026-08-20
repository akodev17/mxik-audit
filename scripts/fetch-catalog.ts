// Downloads the three language variants of the official classifier export.
// The portal generates each file on request, so these are always current.
// Run: npm run fetch:catalog
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BASE = 'https://tasnif.soliq.uz/api/cls-api';

// lang= selects the script; category_id is omitted to get the whole catalogue.
const VARIANTS = [
  { lang: 'uz', out: 'data/classifier_lat.xlsx', label: 'Uzbek Latin' },
  { lang: 'ru', out: 'data/classifier_ru.xlsx', label: 'Russian' },
  { lang: 'uz_cyrl', out: 'data/classifier_uzcyrl.xlsx', label: 'Uzbek Cyrillic' },
] as const;

await mkdir('data', { recursive: true });

for (const v of VARIANTS) {
  const url = `${BASE}/excel/get/category?lang=${v.lang}`;
  process.stdout.write(`${v.label.padEnd(15)} ${url}\n`);
  const t0 = Date.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${v.lang}: HTTP ${res.status}`);
  if (!res.body) throw new Error(`${v.lang}: empty body`);
  const disposition = res.headers.get('content-disposition') ?? '';
  // The DOM and node:stream/web both declare ReadableStream; fromWeb wants the
  // node one, and fetch hands back the DOM one. Structurally identical here.
  const body = res.body as unknown as Parameters<typeof Readable.fromWeb>[0];
  await pipeline(Readable.fromWeb(body), createWriteStream(v.out));
  const { size } = await stat(v.out);
  console.log(`  -> ${v.out}  ${(size / 1_048_576).toFixed(1)} MB  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${disposition}`);
}

console.log('\nnext: npm run ingest            (Excel only)');
console.log('      npm run ingest -- --enrich  (adds the marking flag, ~4 min)');
