// Links that change only the query string must navigate. In production the app router could
// leave such a navigation suspended for good on the firm pages: the request succeeded but the
// address and the content stayed as they were. The shell now loads same-route link targets as a
// new document (src/ui/shell/navigation.ts).
import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Locator, Page } from 'playwright';
import { COMMIT, E2E_PASSWORDS, launch, newPage, setupFirm, signIn, TA, traced, type Fixture } from './fixture';

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

  test('19 empty-state resets on the queue and the activity log clear the filters', { timeout: 90_000 }, async () => {
    const { page } = session;
    await open(page, '/queue?flag=ask_client&due=overdue');
    await follow(page, main(page).locator('a[href="/queue"]').first(), '/queue');

    await open(page, '/activity?from=2030-01-01');
    await follow(page, main(page).locator('a[href="/activity"]').first(), '/activity');
  });
});
