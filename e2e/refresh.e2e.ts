// Refreshes and server actions must commit on their own. In production a router.refresh() after a
// mutation could stay uncommitted until some unrelated state update (on the dashboard: until the
// mutation's toast went away, 6 s later): the same React behaviour as the stuck in-section
// navigations (src/ui/shell/navigation.ts), but these keep the address, so RouteBoundary does not
// cover them. The shell now nudges React after each server response (src/ui/shell/response-nudge.ts).
// Nothing here touches the page between the change and the check, so nothing else can rescue it.
import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import { localDate } from '../src/lib/reminders';
import { db, E2E_PASSWORDS, launch, newPage, setupFirm, signIn, traced, type Fixture } from './fixture';

/** Far below the 6 s toast, whose dismissal used to be what committed a held refresh. */
const SETTLE_MS = 2_000;
const ROUNDS = 4;

describe('refresh after a change', () => {
  let fx: Fixture;
  let browser: Browser;
  let session: { context: BrowserContext; page: Page };
  const test = (name: string, options: { timeout: number }, body: (t: TestContext) => Promise<void>) => it(name, options, traced(() => session?.page, body));

  before(async () => {
    fx = await setupFirm('refresh');
    browser = await launch();
    session = await newPage(browser);
    await signIn(session.page, fx.admin.email, E2E_PASSWORDS.admin);
  });

  after(async () => {
    await browser?.close();
    await fx?.cleanup();
  });

  /** Renames client A in the database, refreshes, and waits for the new name with no input in between. */
  async function refreshShows(page: Page, round: string): Promise<void> {
    const name = `${fx.clientA.name} ${round}`;
    await db.client.update({ where: { id: fx.clientA.id }, data: { name } });
    await page.evaluate(() => (window as unknown as { next: { router: { refresh: () => void } } }).next.router.refresh());
    const shown = await page.waitForFunction(
      (wanted) => document.querySelector('main')?.textContent?.includes(wanted) ?? false,
      name,
      { timeout: SETTLE_MS, polling: 50 },
    ).then(() => true, () => false);
    assert.ok(shown, `the refreshed page shows "${name}" within ${SETTLE_MS} ms`);
  }

  for (const [label, path] of [['dashboard', () => '/dashboard'], ['client page', () => `/clients/${fx.clientA.id}`]] as const) {
    test(`20 router.refresh() on the ${label} commits without any other update`, { timeout: 120_000 }, async () => {
      const { page } = session;
      for (let i = 0; i < ROUNDS; i++) {
        // Right after a page load (when the drop was most frequent), then once more on the same page.
        await page.goto(path());
        await page.locator('main h1').first().waitFor();
        await refreshShows(page, `${label}-${i}a`);
        await page.waitForTimeout(300);
        await refreshShows(page, `${label}-${i}b`);
      }
    });
  }

  test('20 closing a task removes it before its toast goes away', { timeout: 120_000 }, async () => {
    const { page } = session;
    const { date } = localDate(new Date());
    for (let i = 0; i < ROUNDS; i++) {
      await db.reminderTask.deleteMany({ where: { orgId: fx.orgId } });
      for (const client of [fx.clientA, fx.clientB]) await db.reminderTask.create({ data: { orgId: fx.orgId, clientId: client.id, period: `e2e-${i}`, dueOn: date } });
      await page.goto('/dashboard');
      for (const client of [fx.clientA, fx.clientB]) {
        // finishTask revalidates the dashboard, then the task list toasts and calls router.refresh().
        const done = page.locator(`main li button[aria-label*="${client.name}"]`);
        await done.click();
        await done.waitFor({ state: 'detached', timeout: SETTLE_MS });
      }
    }
  });
});
