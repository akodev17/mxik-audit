// A catalogue of a few thousand rows (3000 by default, E2E_SCALE_ROWS to
// change): uploaded and audited through the real pipeline, then the workspace
// is timed: first rows on screen, and j/k from keydown to the next painted
// frame, past the first page of rows so more are loaded on the way.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { Browser, Page } from 'playwright';
import {
  db, digits, E2E_PASSWORDS, gridRows, launch, newPage, plainNumbers, poll, setupFirm, signIn, statValue, TA, traced, XLSX_MIME, xlsxFile,
  type Cell, type Fixture,
} from './fixture';

const ROWS = Number(process.env['E2E_SCALE_ROWS'] ?? 3000);
const AUDIT_TIMEOUT = Number(process.env['E2E_SCALE_AUDIT_TIMEOUT_MS'] ?? 60 * 60_000);
/** The workspace's first page of rows (src/app/(app)/catalogs/[id]/page.tsx); moving past it loads more. */
const FIRST_PAGE = 120;

// Budgets for a production build on a developer machine.
const FIRST_ROWS_MS = 5_000;
const KEY_MEDIAN_MS = 100;
const KEY_P95_MS = 250;

type Demo = { headers: string[]; rows: string[][] };

/** The invented demo catalogue (prisma/demo-catalog.json), repeated as numbered batches up to `n` rows. */
function bigCatalogue(n: number): { headers: string[]; rows: Cell[][] } {
  const demo = JSON.parse(readFileSync(new URL('../../../packages/db/prisma/demo-catalog.json', import.meta.url), 'utf8')) as Demo;
  const rows: Cell[][] = [];
  for (let i = 0; i < n; i++) {
    const base = demo.rows[i % demo.rows.length] ?? [];
    const batch = Math.floor(i / demo.rows.length);
    const [name = '', barcode = '', mxik = '', unit = '', price = ''] = base;
    rows.push([batch === 0 ? name : `${name} (${batch + 1}-partiya)`, batch === 0 ? barcode : '', mxik, unit, price]);
  }
  return { headers: demo.headers, rows };
}

const main = (page: Page) => page.locator('main');
const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN;
};

describe(`a catalogue of ${ROWS} rows`, () => {
  let fx: Fixture;
  let browser: Browser;
  let page: Page;
  let catalogId: string | undefined;
  /** Uncaught page errors while the big workspace loaded; null until it was loaded. */
  let loadErrors: string[] | null = null;
  const test = (name: string, options: { timeout: number }, body: (t: TestContext) => Promise<void>) => it(name, options, traced(() => page, body));

  before(async () => {
    fx = await setupFirm('scale');
    browser = await launch();
    ({ page } = await newPage(browser));
    await signIn(page, fx.admin.email, E2E_PASSWORDS.admin);
  });

  after(async () => {
    await browser?.close();
    await fx?.cleanup();
  });

  test(`16 ${ROWS} rows upload through the wizard and are audited`, { timeout: AUDIT_TIMEOUT + 300_000 }, async (t) => {
    const { headers, rows } = bigCatalogue(ROWS);
    await page.goto(`/upload?client=${fx.clientA.id}`);
    await main(page).locator('input[type="file"]').setInputFiles({ name: `e2e-katta-katalog-${ROWS}.xlsx`, mimeType: XLSX_MIME, buffer: await xlsxFile(headers, rows) });
    await main(page).getByRole('heading', { name: TA.importX.check.title }).waitFor({ timeout: 180_000 });
    const id = new URL(page.url()).searchParams.get('catalog');
    assert.ok(id);
    await main(page).getByRole('button', { name: TA.importX.check.next, exact: true }).click();
    await main(page).getByRole('heading', { name: TA.importX.map.title }).waitFor();
    const next = main(page).getByRole('button', { name: TA.importX.map.next, exact: true });
    await poll('mapping ready', () => next.isEnabled(), Boolean, 60_000, 250);
    await next.click();
    await main(page).getByRole('heading', { name: TA.importX.confirm.title }).waitFor();
    assert.ok(plainNumbers((await main(page).textContent()) ?? '').includes(plainNumbers(TA.importX.confirm.rows(ROWS))), `confirm step: ${ROWS} rows`);
    await main(page).getByRole('button', { name: TA.importX.confirm.start, exact: true }).click();

    const started = Date.now();
    let lastLog = started;
    const final = await poll('the audit', async () => {
      const c = await db.catalog.findUnique({ where: { id }, select: { status: true, progressDone: true, auditError: true } });
      if (Date.now() - lastLog > 60_000) {
        lastLog = Date.now();
        t.diagnostic(`${Math.round((Date.now() - started) / 1000)} s: ${c?.progressDone ?? 0} / ${ROWS} rows audited`);
      }
      return c;
    }, (c) => c?.status === 'ready' || c?.status === 'failed', AUDIT_TIMEOUT, 3_000);
    const seconds = (Date.now() - started) / 1000;
    t.diagnostic(`audit of ${ROWS} rows: ${seconds.toFixed(0)} s, ${(ROWS / seconds).toFixed(1)} rows/s`);
    assert.equal(final?.status, 'ready', `audit ended ${final?.status}: ${final?.auditError ?? ''}`);
    catalogId = id;

    await main(page).getByRole('heading', { name: TA.importX.done.title }).waitFor({ timeout: 60_000 });
    assert.equal(digits(await statValue(page, TA.importX.done.rows)), ROWS, 'done screen counts every row');
  });

  test('16 the workspace shows its first rows quickly and j/k stays responsive', { timeout: 300_000 }, async (t) => {
    if (!catalogId) { t.skip('needs the audited catalogue'); return; }
    const url = `/catalogs/${catalogId}?sort=row&v=0`;
    const total = await db.finding.count({ where: { item: { catalogId }, decision: 'pending', severity: { in: ['high', 'medium'] } } });
    t.diagnostic(`${total} pending risky findings in the grid`);
    assert.ok(total > FIRST_PAGE + 20, `enough findings to page past the first ${FIRST_PAGE}`);

    const errors: string[] = [];
    const onError = (e: Error): void => { errors.push(e.message); };
    page.on('pageerror', onError);
    const firstRows: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      await page.goto(url, { waitUntil: 'commit' });
      await gridRows(page).first().waitFor({ timeout: 60_000 });
      firstRows.push(Date.now() - t0);
    }
    await page.waitForTimeout(1_000);
    page.off('pageerror', onError);
    loadErrors = errors;
    t.diagnostic(`time to first rows (navigation start to first grid row visible): ${firstRows.join(' ms, ')} ms`);
    const inDom = await gridRows(page).count();
    t.diagnostic(`rows in the DOM (virtualised): ${inDom}`);
    assert.ok(inDom < 200, 'only the rows on screen are rendered');
    assert.ok(Math.min(...firstRows) <= FIRST_ROWS_MS, `first rows within ${FIRST_ROWS_MS} ms (best of 3)`);

    // keydown → the grid's active row changes → next frame, measured inside the page.
    await page.evaluate(() => {
      const w = window as unknown as { __keyLatency: number[] };
      w.__keyLatency = [];
      let pressed = 0;
      window.addEventListener('keydown', (e) => { if (e.code === 'KeyJ' || e.code === 'KeyK') pressed = performance.now(); }, true);
      const grid = document.querySelector('[role="grid"]');
      if (!grid) throw new Error('no grid');
      new MutationObserver(() => {
        if (!pressed) return;
        const start = pressed;
        pressed = 0;
        requestAnimationFrame(() => w.__keyLatency.push(performance.now() - start));
      }).observe(grid, { attributes: true, attributeFilter: ['aria-activedescendant'] });
    });
    const grid = page.locator('[role="grid"]');
    const activeIndex = async (): Promise<number> => page.evaluate(() => {
      const id = document.querySelector('[role="grid"]')?.getAttribute('aria-activedescendant');
      return Number(id ? document.getElementById(id)?.getAttribute('aria-rowindex') : NaN) - 2;
    });
    assert.equal(await activeIndex(), 0);

    const presses = FIRST_PAGE + 15;
    const started = Date.now();
    for (let i = 1; i <= presses; i++) {
      const before = await grid.getAttribute('aria-activedescendant');
      await page.keyboard.press('j');
      await page.waitForFunction((prev) => document.querySelector('[role="grid"]')?.getAttribute('aria-activedescendant') !== prev, before, { polling: 'raf', timeout: 10_000 });
    }
    t.diagnostic(`${presses} j presses in ${Date.now() - started} ms (Playwright round trips included)`);
    assert.equal(await activeIndex(), presses, `j walked ${presses} rows, past the first page: more rows were loaded`);
    for (let i = 0; i < 20; i++) {
      const before = await grid.getAttribute('aria-activedescendant');
      await page.keyboard.press('k');
      await page.waitForFunction((prev) => document.querySelector('[role="grid"]')?.getAttribute('aria-activedescendant') !== prev, before, { polling: 'raf', timeout: 10_000 });
    }
    assert.equal(await activeIndex(), presses - 20, 'k walks back');

    const latency = await page.evaluate(() => (window as unknown as { __keyLatency: number[] }).__keyLatency);
    const median = percentile(latency, 50);
    const p95 = percentile(latency, 95);
    t.diagnostic(`j/k latency over ${latency.length} presses: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${Math.max(...latency).toFixed(1)} ms`);
    assert.ok(latency.length >= presses, 'every press was measured');
    assert.ok(median <= KEY_MEDIAN_MS, `median j/k latency within ${KEY_MEDIAN_MS} ms`);
    assert.ok(p95 <= KEY_P95_MS, `p95 j/k latency within ${KEY_P95_MS} ms`);
  });

  test('16 the big workspace hydrates without page errors', { timeout: 30_000 }, async (t) => {
    if (loadErrors === null) { t.skip('needs the workspace load from the previous test'); return; }
    // React's minified error #418 is a hydration text mismatch: the server (Node ICU) formats
    // 3000 as "3 000", Chromium as "3,000", so the summary's numbers differ on hydration.
    assert.deepEqual(loadErrors, [], 'no uncaught errors while the workspace of a large catalogue loads');
  });
});
