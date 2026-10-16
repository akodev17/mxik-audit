// Captures real screenshots of the running app, at desktop and phone widths.
//
// These are not used on the landing page — that page explains the product
// with its own diagrams. They are for documentation, demos and design review,
// and the rule that produced them still holds: this drives the actual app and
// captures the actual screens. It never renders a mockup.
//
// Report, review, catalogue list and export come from a fresh /demo session,
// so nothing real is touched (needs `npm run seed:demo`). The upload screen is
// disabled in demo mode, so that one shot signs in to the seeded org
// (`npm run seed`) and afterwards deletes only the catalogue it created there.
//
// Run: the app running elsewhere (npm run dev, or a production build), then
//      npm run capture       (CAPTURE_BASE_URL defaults to http://localhost:3000)
import '../src/lib/load-env.js';
import { mkdir } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';
import { db } from '../src/lib/db.js';

const BASE = process.env['CAPTURE_BASE_URL'] ?? 'http://localhost:3000';
const EMAIL = process.env['SEED_EMAIL'] ?? 'buxgalter@demo.uz';
const PASSWORD = process.env['SEED_PASSWORD'] ?? 'demo12345';
const OUT = 'public/screenshots';
const SAMPLE = 'public/demo/namuna-katalog.xlsx';

type Shot = {
  file: string;
  path: string;
  width: number;
  /** Viewport height, chosen per screen so there is no dead whitespace. */
  height: number;
  clipTo?: string;
};

const DESKTOP = 1280;
const PHONE = 375;

const DEMO_SHOTS: Shot[] = [
  { file: 'report-headline.png', path: '/report', width: DESKTOP, height: 700, clipTo: 'section' },
  { file: 'step-2-report.png', path: '/report', width: DESKTOP, height: 760 },
  { file: 'step-3-review.png', path: '/review', width: DESKTOP, height: 820 },
  { file: 'step-4-export.png', path: '/export', width: DESKTOP, height: 640 },
  { file: 'catalogs.png', path: '/catalogs', width: DESKTOP, height: 520 },
  { file: 'report-mobile.png', path: '/report', width: PHONE, height: 812 },
  { file: 'review-mobile.png', path: '/review', width: PHONE, height: 812 },
];

async function capture(page: Page, shot: Shot): Promise<void> {
  await page.setViewportSize({ width: shot.width, height: shot.height });
  await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' });
  // Next compiles a route on first hit in dev; let slow ones settle.
  await page.waitForTimeout(1000);
  const target = shot.clipTo ? page.locator(shot.clipTo).first() : page;
  await target.screenshot({ path: `${OUT}/${shot.file}` });
  console.log(`  ${shot.file.padEnd(22)} ${shot.path}  ${shot.width}x${shot.height}`);
}

async function demoShots(browser: Browser): Promise<void> {
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  const page = await context.newPage();
  console.log(`starting a demo session at ${BASE}/demo`);
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/report/, { timeout: 60_000 });
  for (const shot of DEMO_SHOTS) await capture(page, shot);
  await context.close();
}

async function uploadShot(browser: Browser): Promise<void> {
  const user = await db.user.findUnique({ where: { email: EMAIL }, select: { orgId: true } });
  if (!user) {
    console.log(`  (skipping step-1-upload.png: no ${EMAIL}; run npm run seed)`);
    return;
  }
  const before = new Set((await db.catalog.findMany({ where: { orgId: user.orgId }, select: { id: true } })).map((c) => c.id));

  const context = await browser.newContext({ viewport: { width: DESKTOP, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/report/, { timeout: 60_000 });
  await page.goto(`${BASE}/upload`, { waitUntil: 'networkidle' });
  // Upload the sample so the shot shows column mapping and the row preview.
  await page.setInputFiles('input[type="file"]', SAMPLE);
  await page.waitForSelector('#map-name', { timeout: 60_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/step-1-upload.png` });
  console.log(`  step-1-upload.png      /upload  ${DESKTOP}x900`);
  await context.close();

  // The preview stored a catalogue in this org; remove exactly that one.
  const created = await db.catalog.findMany({
    where: { orgId: user.orgId, id: { notIn: [...before] } },
    select: { id: true, filename: true },
  });
  for (const c of created) {
    await db.catalog.delete({ where: { id: c.id } });
    console.log(`  cleaned up preview catalogue ${c.filename}`);
  }
}

await mkdir(OUT, { recursive: true });
// CAPTURE_CHANNEL=msedge (or chrome) drives an installed browser instead of
// Playwright's own, which `npx playwright install chromium` would download.
const channel = process.env['CAPTURE_CHANNEL'];
const browser = await chromium.launch(channel ? { channel } : {});
try {
  await demoShots(browser);
  await uploadShot(browser);
} finally {
  await browser.close();
  await db.$disconnect();
}
console.log(`\nwrote screenshots to ${OUT}/ — photographs of the running app, not mockups.`);
