// A brand-new firm (one admin, nothing else): the dashboard leads with the
// onboarding checklist and every list says plainly that it is empty.
import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import { COMMIT, E2E_PASSWORDS, launch, newPage, setupEmptyOrg, signIn, TA, traced, type EmptyFixture } from './fixture';

const main = (page: Page) => page.locator('main');

describe('empty states of a new firm', () => {
  let fx: EmptyFixture;
  let browser: Browser;
  let session: { context: BrowserContext; page: Page };
  const test = (name: string, options: { timeout: number }, body: (t: TestContext) => Promise<void>) => it(name, options, traced(() => session?.page, body));

  before(async () => {
    fx = await setupEmptyOrg('empty');
    browser = await launch();
    session = await newPage(browser);
    await signIn(session.page, fx.admin.email, E2E_PASSWORDS.admin);
  });

  after(async () => {
    await browser?.close();
    await fx?.cleanup();
  });

  test('17 the dashboard shows the onboarding checklist with nothing done', { timeout: 60_000 }, async () => {
    const { page } = session;
    const o = TA.firmX.onboarding;
    await page.goto('/dashboard');
    const checklist = page.getByRole('region', { name: o.title });
    await checklist.waitFor();
    const steps = checklist.locator('ol > li');
    const n = await steps.count();
    assert.ok(n >= 5, `client, upload, review, invite and two-factor steps at least (got ${n})`);
    assert.ok(((await checklist.textContent()) ?? '').includes(o.progress(0, n)), 'progress says nothing is done yet');
    const text = (await checklist.textContent()) ?? '';
    for (const key of ['client', 'upload', 'review', 'invite', 'twoFactor'] as const) {
      assert.ok(text.includes(o.steps[key].label), `step "${o.steps[key].label}" is listed`);
    }
    // Every open step has its action; the first one leads to adding a client.
    assert.equal(await steps.getByRole('link').count(), n, 'each open step links to where it is done');
    const first = steps.first().getByRole('link', { name: o.steps.client.cta, exact: true });
    assert.equal(await first.getAttribute('href'), '/clients?new=1');

    await Promise.all([page.waitForURL((url) => url.pathname === '/clients', COMMIT), first.click()]);
    await page.getByRole('dialog', { name: TA.firmX.clients.dialogTitle }).waitFor();
  });

  test('17 lists of a new firm say they are empty', { timeout: 60_000 }, async () => {
    const { page } = session;
    const empty = async (path: string, title: string): Promise<void> => {
      await page.goto(path);
      await main(page).getByText(title, { exact: true }).waitFor();
    };
    await empty('/catalogs', TA.catalogs.emptyTitle);
    assert.ok(await main(page).getByRole('link', { name: TA.catalogs.uploadCta, exact: true }).count() >= 1, 'the empty catalogue list offers an upload');
    await empty('/queue', TA.firmX.queue.emptyTitle);
    await empty('/dictionary', TA.wsX.dict.emptyTitle);
    await empty('/notifications', TA.shellX.notices.emptyAll);
  });
});
