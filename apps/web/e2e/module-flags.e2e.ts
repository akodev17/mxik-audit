// Module flags end to end: Didox HIDDEN (no tab, /didox and its API are 404), COMING_SOON (a muted
// tab with the badge, the coming-soon page, the dashboard list, the API still 404) and ENABLED again;
// /admin/features is a 404 for an ordinary admin. The states are written straight into feature_flag,
// so each step waits out the 30 s caches of the API and the web process.
//
// With E2E_PLATFORM_EMAIL set to an address listed in the API's ADMIN_EMAILS, the firm's admin takes
// that address and the platformAdmin flag, and saves a state through the /admin/features page itself.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import { ARTIFACTS, db, E2E_PASSWORDS, launch, newPage, poll, setupFirm, signIn, TA, traced, type Fixture } from './fixture';

const F = TA.featuresX;
const DIDOX = TA.accountingX.nav.didox;
const WAIT = 75_000;
const headerNav = (page: Page) => page.getByRole('navigation', { name: TA.shellX.nav.label, exact: true });
const shot = (page: Page, name: string) => page.screenshot({ path: join(ARTIFACTS, `module-flags-${name}.png`) });

type State = 'ENABLED' | 'COMING_SOON' | 'HIDDEN';
const setDidox = (state: State) => db.featureFlag.upsert({ where: { key: 'didox' }, create: { key: 'didox', state }, update: { state } });

/** What /didox answers now: its status and whether it is the coming-soon page. */
async function didoxPage(page: Page): Promise<{ status: number; soon: boolean }> {
  const res = await page.goto('/didox');
  await page.locator('main h1').first().waitFor();
  return { status: res?.status() ?? 0, soon: await page.getByText(F.page.hint, { exact: true }).isVisible() };
}

describe('module flags', () => {
  let fx: Fixture;
  let browser: Browser;
  let admin: { context: BrowserContext; page: Page };
  let saved: { key: string; state: State }[] = [];
  const test = (name: string, options: { timeout: number }, body: (t: TestContext) => Promise<void>) => it(name, options, traced(() => admin?.page, body));

  before(async () => {
    saved = await db.featureFlag.findMany({ select: { key: true, state: true } });
    fx = await setupFirm('flags');
    browser = await launch();
    admin = await newPage(browser, { width: 1920, height: 1000 });
    await signIn(admin.page, fx.admin.email, E2E_PASSWORDS.admin);
    mkdirSync(ARTIFACTS, { recursive: true });
  });

  after(async () => {
    // Back to the rows the database had before this file ran.
    await db.featureFlag.deleteMany({ where: { key: { notIn: saved.map((r) => r.key) } } });
    for (const row of saved) await db.featureFlag.update({ where: { key: row.key }, data: { state: row.state } });
    await browser?.close();
    await fx?.cleanup();
  });

  test('/admin/features is the 404 for anyone who is not a platform admin', { timeout: 60_000 }, async () => {
    const res = await admin.page.goto('/admin/features');
    assert.equal(res?.status(), 404);
    await admin.page.getByRole('heading', { name: TA.shellX.notFound.title }).first().waitFor();
    assert.equal(await admin.page.getByRole('heading', { name: F.admin.title }).count(), 0);
  });

  test('HIDDEN: no tab, /didox is a 404 and so is its API', { timeout: WAIT + 30_000 }, async () => {
    const { page } = admin;
    await setDidox('HIDDEN');
    await poll('/didox to be a 404', () => didoxPage(page), (v) => v.status === 404, WAIT, 2000);
    await page.goto('/didox/some-batch');
    await page.getByRole('heading', { name: TA.shellX.notFound.title }).first().waitFor();
    assert.equal((await page.request.get('/api/didox/invoices')).status(), 404);
    await page.goto('/dashboard');
    await page.locator('main h1').first().waitFor();
    assert.equal(await headerNav(page).getByText(DIDOX).count(), 0, 'no Didox tab');
    assert.equal(await page.getByRole('region', { name: F.dashboard.title }).count(), 0, 'nothing coming soon');
    await shot(page, 'hidden-dashboard');
  });

  test('COMING_SOON: a muted tab with the badge, the coming-soon page, the dashboard list, the API 404', { timeout: WAIT + 30_000 }, async () => {
    const { page } = admin;
    await setDidox('COMING_SOON');
    const soon = await poll('/didox to show the coming-soon page', () => didoxPage(page), (v) => v.soon, WAIT, 2000);
    assert.equal(soon.status, 200);
    assert.equal(await page.locator('main h1').first().textContent(), F.modules.didox.label);
    await shot(page, 'soon-page');
    assert.equal((await page.request.get('/api/didox/invoices')).status(), 404);

    await page.goto('/dashboard');
    await page.locator('main h1').first().waitFor();
    const tab = headerNav(page).locator('[aria-disabled="true"]', { hasText: DIDOX });
    assert.equal(await tab.count(), 1, 'the tab is there, disabled');
    assert.match((await tab.textContent()) ?? '', new RegExp(F.soon));
    assert.equal(await headerNav(page).getByRole('link', { name: DIDOX }).count(), 0, 'and not a link');
    const list = page.getByRole('region', { name: F.dashboard.title });
    await list.waitFor();
    assert.ok((await list.textContent())?.includes(F.modules.didox.description));
    assert.equal(await list.getByRole('link').count(), 0);
    await list.scrollIntoViewIfNeeded();
    await shot(page, 'soon-dashboard');
  });

  test('ENABLED again: the tab is a link and /didox and its API answer', { timeout: WAIT + 30_000 }, async () => {
    const { page } = admin;
    await setDidox('ENABLED');
    await poll('/didox to be the Didox page', () => didoxPage(page), (v) => v.status === 200 && !v.soon, WAIT, 2000);
    assert.notEqual((await page.request.get('/api/didox/invoices')).status(), 404);
    await page.goto('/dashboard');
    await page.locator('main h1').first().waitFor();
    assert.equal(await headerNav(page).getByRole('link', { name: DIDOX }).count(), 1);
    assert.equal(await page.getByRole('region', { name: F.dashboard.title }).count(), 0);
  });

  const owner = process.env['E2E_PLATFORM_EMAIL']?.trim().toLowerCase();
  it('a platform admin saves a state on /admin/features', { timeout: 120_000, skip: owner ? false : 'E2E_PLATFORM_EMAIL is not set' }, traced(() => admin?.page, async () => {
    const email = owner ?? '';
    // A user left over from an interrupted run would hold the address.
    await db.user.deleteMany({ where: { email, NOT: { id: fx.admin.id } } });
    await db.user.update({ where: { id: fx.admin.id }, data: { email, platformAdmin: true } });
    const own = await newPage(browser, { width: 1440, height: 900 });
    try {
      await signIn(own.page, email, E2E_PASSWORDS.admin);
      const { page } = own;
      assert.equal((await page.goto('/admin/features'))?.status(), 200);
      await page.getByRole('heading', { name: F.admin.title }).waitFor();
      const bank = page.getByRole('group', { name: F.modules.bank.label });
      assert.equal(await bank.getByRole('radio', { name: F.admin.enabled }).isChecked(), true);
      await bank.getByRole('radio', { name: F.admin.comingSoon }).check();
      await shot(page, 'admin');
      await page.getByRole('button', { name: F.admin.save }).click();
      await page.getByText(F.admin.saved).first().waitFor();
      assert.equal((await db.featureFlag.findUnique({ where: { key: 'bank' } }))?.state, 'COMING_SOON');
      // The API process that saved dropped its cache: the module's API is refused at once.
      assert.equal((await page.request.get('/api/bank/statements')).status(), 404);
    } finally {
      await own.context.close();
    }
  }));
});
