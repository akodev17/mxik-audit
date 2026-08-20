// Captures real screenshots of the running app for the landing page.
//
// The landing page states these are photographs of the working tool, so they must
// be: this signs in to the actual dev server and captures the actual screens. It
// never renders a mockup.
//
// Order matters. The upload shot has to run last, because previewing a file
// creates a fresh catalogue row and /report and /review both read the newest
// catalogue — capturing them afterwards would show an empty report. The extra
// catalogue is deleted at the end.
//
// Run: npm run dev (elsewhere), then npm run capture
import '../src/lib/load-env.js';
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { db } from '../src/lib/db.js';

const BASE = process.env['CAPTURE_BASE_URL'] ?? 'http://localhost:3100';
const EMAIL = process.env['SEED_EMAIL'] ?? 'buxgalter@demo.uz';
const PASSWORD = process.env['SEED_PASSWORD'] ?? 'demo12345';
const OUT = 'public/screenshots';
const SAMPLE = 'public/demo/namuna-katalog.xlsx';

const WIDTH = 1280;

type Shot = {
  file: string;
  path: string;
  /** Viewport height, chosen per screen so there is no dead whitespace. */
  height: number;
  clipTo?: string;
  prepare?: (page: Page) => Promise<void>;
};

const SHOTS: Shot[] = [
  { file: 'report-headline.png', path: '/report', height: 700, clipTo: 'section' },
  { file: 'step-2-report.png', path: '/report', height: 760 },
  { file: 'step-3-review.png', path: '/review', height: 820 },
  {
    file: 'step-1-upload.png',
    path: '/upload',
    height: 900,
    // Upload the sample so the shot shows column mapping and the row preview,
    // which is the part of this screen worth showing.
    prepare: async (page) => {
      await page.setInputFiles('input[type="file"]', SAMPLE);
      await page.waitForSelector('#map-name', { timeout: 60_000 });
      await page.waitForTimeout(900);
    },
  },
];

const before = await db.catalog.count();

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: WIDTH, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

console.log(`signing in at ${BASE} as ${EMAIL}`);
await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/\/report/, { timeout: 60_000 });
console.log('signed in');

await mkdir(OUT, { recursive: true });

for (const shot of SHOTS) {
  await page.setViewportSize({ width: WIDTH, height: shot.height });
  await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' });
  // Next compiles a route on first hit; let slow ones settle.
  await page.waitForTimeout(1000);
  if (shot.prepare) await shot.prepare(page);

  const target = shot.clipTo ? page.locator(shot.clipTo).first() : page;
  await target.screenshot({ path: `${OUT}/${shot.file}` });
  console.log(`  ${shot.file.padEnd(22)} ${shot.path}  ${WIDTH}x${shot.height}`);
}

await browser.close();

// Remove the catalogue the upload preview created, so the demo keeps exactly one.
const extras = await db.catalog.findMany({
  orderBy: { createdAt: 'desc' },
  take: Math.max(0, (await db.catalog.count()) - before),
  select: { id: true, filename: true, status: true },
});
for (const extra of extras) {
  await db.catalog.delete({ where: { id: extra.id } });
  console.log(`\ncleaned up preview catalogue ${extra.filename} (${extra.status})`);
}

console.log(`\nwrote ${SHOTS.length} screenshots to ${OUT}/`);
console.log('Photographs of the running app, not mockups.');
await db.$disconnect();
