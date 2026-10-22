// Navigations inside one section must commit: query-only links (filter tabs, resets, pagers) and
// list <-> record moves. In production they could stay suspended for good: the transition rendered
// under the already visible (app) loading boundary, and React dropped the ping of a server
// component chunk that resolved mid-render (see src/ui/shell/navigation.ts). The shell now gives
// every address a fresh Suspense boundary (src/ui/shell/route-boundary.tsx). Run with
// E2E_NO_NAV_FALLBACK=1 to prove it without the watchdog: any navigation it has to rescue fails.
import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Locator, Page, Route } from 'playwright';
import { COMMIT, E2E_PASSWORDS, launch, newPage, setupFirm, signIn, T, TA, traced, type Fixture } from './fixture';

const main = (page: Page) => page.locator('main');
const NAV_TIMEOUT = 15_000;

/** Opens a page and lets its link prefetches settle, which is when the bug showed. */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await main(page).locator('h1').first().waitFor();
  await page.waitForLoadState('networkidle');
}

/** Clicks a link and waits until the address shows the expected path and query. */
async function follow(page: Page, link: Locator, expected: string): Promise<void> {
  await link.waitFor();
  await Promise.all([
    page.waitForURL((url) => `${url.pathname}${url.search}` === expected, { ...COMMIT, timeout: NAV_TIMEOUT }),
    link.click(),
  ]);
}

describe('query-only navigation', () => {
  let fx: Fixture;
  let browser: Browser;
  let session: { context: BrowserContext; page: Page };
  const test = (name: string, options: { timeout: number }, body: (t: TestContext) => Promise<void>) => it(name, options, traced(() => session?.page, body));

  before(async () => {
    fx = await setupFirm('qnav');
    browser = await launch();
    session = await newPage(browser);
    await signIn(session.page, fx.admin.email, E2E_PASSWORDS.admin);
  });

  after(async () => {
    await browser?.close();
    await fx?.cleanup();
  });

  test('19 client filter tabs and the sidebar link switch the list', { timeout: 90_000 }, async () => {
    const { page } = session;
    await open(page, '/clients');
    const stale = main(page).locator('a[href="/clients?filter=stale"]').first();
    await follow(page, stale, '/clients?filter=stale');
    assert.equal(await stale.getAttribute('aria-current'), 'page', 'the stale tab is now the current one');

    await page.waitForLoadState('networkidle');
    await follow(page, main(page).locator('a[href="/clients"]').first(), '/clients');

    await open(page, '/clients?filter=archived');
    await follow(page, page.getByRole('link', { name: TA.nav.clients, exact: true }).first(), '/clients');
  });

  test('19 a client row opens the client, the breadcrumb returns to the list, and the content follows', { timeout: 90_000 }, async () => {
    const { page } = session;
    await open(page, '/clients');
    const name = fx.clientA.name;
    const row = main(page).getByRole('link', { name, exact: true }).first();
    await follow(page, row, `/clients/${fx.clientA.id}`);
    await main(page).getByRole('heading', { level: 1, name }).waitFor({ timeout: NAV_TIMEOUT });

    await page.waitForLoadState('networkidle');
    await follow(page, page.getByRole('navigation', { name: TA.shellX.ui.breadcrumbs }).getByRole('link', { name: TA.nav.clients, exact: true }).first(), '/clients');
    await main(page).getByRole('heading', { level: 1, name: T.clientsTitle }).waitFor({ timeout: NAV_TIMEOUT });

    await page.waitForLoadState('networkidle');
    const other = main(page).getByRole('link', { name: fx.clientB.name, exact: true }).first();
    await follow(page, other, `/clients/${fx.clientB.id}`);
    await main(page).getByRole('heading', { level: 1, name: fx.clientB.name }).waitFor({ timeout: NAV_TIMEOUT });
  });

  test('19 empty-state resets on the queue and the activity log clear the filters', { timeout: 90_000 }, async () => {
    const { page } = session;
    await open(page, '/queue?flag=ask_client&due=overdue');
    await follow(page, main(page).locator('a[href="/queue"]').first(), '/queue');

    await open(page, '/activity?from=2030-01-01');
    await follow(page, main(page).locator('a[href="/activity"]').first(), '/activity');
  });

  /** Records whether the page skeleton appears in main from now on (src/ui/skeleton.tsx). */
  const watchSkeleton = (page: Page) => page.evaluate(() => {
    const w = window as unknown as { __sawSkeleton?: boolean };
    w.__sawSkeleton = false;
    const root = document.querySelector('main');
    if (root) new MutationObserver(() => { if (root.querySelector('[aria-busy="true"]')) w.__sawSkeleton = true; }).observe(root, { childList: true, subtree: true });
  });
  const sawSkeleton = (page: Page) => page.evaluate(() => (window as unknown as { __sawSkeleton?: boolean }).__sawSkeleton === true);

  test('20 settings tabs and workspace filters change in place: they commit, without the skeleton', { timeout: 90_000 }, async () => {
    const { page } = session;
    await open(page, '/settings');
    for (const tab of ['/settings?tab=security', '/settings?tab=plan', '/settings']) {
      await page.waitForLoadState('networkidle');
      await watchSkeleton(page);
      const link = main(page).locator(`a[href="${tab}"]:visible`).first();
      await follow(page, link, tab);
      await main(page).locator(`a[aria-current="page"][href="${tab}"]:visible`).first().waitFor({ timeout: NAV_TIMEOUT });
      assert.equal(await sawSkeleton(page), false, `${tab} opened without the page skeleton`);
    }

    await open(page, `/catalogs/${fx.clientBCatalogId}`);
    await page.locator('[role="grid"]').waitFor();
    await watchSkeleton(page);
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get('dec') === 'all', { ...COMMIT, timeout: NAV_TIMEOUT }),
      main(page).locator('select:has(option[value="carried"])').first().selectOption('all'),
    ]);
    await page.locator('[role="grid"]').waitFor({ timeout: NAV_TIMEOUT });
    assert.equal(await sawSkeleton(page), false, 'the decision filter changed without the page skeleton');
  });

  // A page that is slow to appear (its JavaScript compiled on a first visit in dev, or slow to download)
  // used to look like an ignored click: the skeleton stayed, and every further click on its tab started
  // another full server render of the same page.
  test('21 a page slow to appear opens from one click: more clicks start no second render, and nothing reloads', { timeout: 120_000 }, async () => {
    const { page } = session;
    const SLOW_MS = 6_000;
    await open(page, '/dashboard');
    let renders = 0;
    const isQueueRender = (url: URL): boolean => url.pathname === '/queue' && url.searchParams.has('_rsc');
    const countRender = async (route: Route): Promise<void> => {
      // Link prefetches (loading boundary only) carry this header; a render of the page does not.
      if (!route.request().headers()['next-router-prefetch']) renders += 1;
      await route.continue();
    };
    const isQueueChunk = (url: URL): boolean => url.pathname.startsWith('/_next/static/chunks/app/') && url.pathname.includes('/queue/page');
    const holdChunk = async (route: Route): Promise<void> => {
      await new Promise((r) => setTimeout(r, SLOW_MS));
      await route.continue();
    };
    await page.route(isQueueRender, countRender);
    await page.route(isQueueChunk, holdChunk);
    try {
      await page.evaluate(() => { (window as unknown as { __sameDocument?: boolean }).__sameDocument = true; });
      const tab = page.locator('header a[href="/queue"]').first();
      await tab.click();
      for (let i = 0; i < 4; i++) {
        await page.waitForTimeout(500);
        await tab.click();
      }
      await page.waitForURL((url) => url.pathname === '/queue', { ...COMMIT, timeout: NAV_TIMEOUT });
      await main(page).getByRole('heading', { level: 1, name: TA.firmX.queue.title }).waitFor({ timeout: SLOW_MS + NAV_TIMEOUT });
      assert.equal(renders, 1, 'five clicks, one server render of the page');
      assert.equal(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true), true, 'the page was not reloaded as a document');
    } finally {
      await page.unroute(isQueueRender, countRender);
      await page.unroute(isQueueChunk, holdChunk);
    }
  });
});
