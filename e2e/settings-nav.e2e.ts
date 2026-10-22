// Settings reached from the left rail's gear (no longer a header tab), and its sections as a vertical menu
// beside the content: one-click switching, history, reload, permissions and a usable phone layout.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import { ARTIFACTS, COMMIT, E2E_PASSWORDS, launch, newPage, setupFirm, signIn, TA, traced, type Fixture } from './fixture';

const S = TA.setX.tabs;
const rail = (page: Page) => page.getByRole('navigation', { name: TA.shellX.nav.utilities, exact: true });
const headerNav = (page: Page) => page.getByRole('navigation', { name: TA.shellX.nav.label, exact: true });
const sections = (page: Page) => page.getByRole('navigation', { name: S.label, exact: true });

describe('settings navigation', () => {
  let fx: Fixture;
  let browser: Browser;
  let admin: { context: BrowserContext; page: Page };
  const test = (name: string, options: { timeout: number }, body: (t: TestContext) => Promise<void>) => it(name, options, traced(() => admin?.page, body));

  before(async () => {
    fx = await setupFirm('settingsnav');
    browser = await launch();
    admin = await newPage(browser);
    await signIn(admin.page, fx.admin.email, E2E_PASSWORDS.admin);
    mkdirSync(ARTIFACTS, { recursive: true });
  });

  after(async () => {
    await browser?.close();
    await fx?.cleanup();
  });

  test('the gear sits in the left rail with bell and help, and settings is no longer a header tab', { timeout: 90_000 }, async () => {
    const { page } = admin;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
    await page.locator('main h1').first().waitFor();
    assert.equal(await headerNav(page).getByRole('link', { name: TA.nav.settings, exact: true }).count(), 0, 'no Sozlamalar tab in the header');
    const links = await rail(page).getByRole('link').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    assert.deepEqual(links.slice(0, 3), [TA.shellX.bell.title, TA.shellX.nav.help, TA.nav.settings], 'bell and help keep their places, the gear follows');

    const gear = rail(page).getByRole('link', { name: TA.nav.settings, exact: true });
    await gear.hover();
    await rail(page).getByRole('tooltip').filter({ hasText: TA.nav.settings }).waitFor();
    assert.equal(await gear.getAttribute('aria-current'), null, 'not current on another page');
    await Promise.all([page.waitForURL((u) => u.pathname === '/settings', COMMIT), gear.click()]);
    await page.locator('main h1').first().waitFor();
    assert.equal(await gear.getAttribute('aria-current'), 'page', 'current on settings');
    // Other header tabs are still there, in order.
    const hrefs = await headerNav(page).locator('ul a').evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    assert.ok(hrefs.includes('/dashboard') && hrefs.includes('/catalogs') && !hrefs.includes('/settings'));
  });

  test('the sections are a vertical menu beside the content, one click each', { timeout: 120_000 }, async () => {
    const { page } = admin;
    for (const width of [1440, 1024, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/settings');
      await page.locator('main h1').first().waitFor();
      const menu = sections(page);
      const items = await menu.getByRole('link').all();
      assert.equal(items.length, 5, `${width}: five sections for an admin`);
      const boxes = await Promise.all(items.map((i) => i.boundingBox()));
      const first = boxes[0];
      const last = boxes[4];
      assert.ok(first && last && Math.abs(first.x - last.x) < 1 && last.y > first.y, `${width}: stacked vertically`);
      const content = await page.locator('main form, main section, main h2').first().boundingBox();
      assert.ok(content && content.x >= first.x + first.width - 0.5, `${width}: the content is to the right of the menu`);
      assert.equal(await menu.getByRole('link', { name: S.account, exact: true }).getAttribute('aria-current'), 'page');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${width}: no sideways scroll`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/settings');
    await sections(page).waitFor();
    await page.screenshot({ path: join(ARTIFACTS, 'settings-vertical-nav.png') });

    for (const [id, name] of [['security', S.security], ['plan', S.plan], ['integrations', S.integrations], ['data', S.data]] as const) {
      await Promise.all([page.waitForURL((u) => u.searchParams.get('tab') === id, COMMIT), sections(page).getByRole('link', { name, exact: true }).click()]);
      await page.locator('main h1').first().waitFor();
      assert.equal(await sections(page).getByRole('link', { name, exact: true }).getAttribute('aria-current'), 'page', `${id} is highlighted after one click`);
      assert.equal(await sections(page).locator('[aria-current="page"]').count(), 1, `${id}: only one highlighted`);
    }
  });

  test('history, reload and direct URLs keep the section', { timeout: 120_000 }, async () => {
    const { page } = admin;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/settings?tab=plan');
    await sections(page).getByRole('link', { name: S.plan, exact: true }).waitFor();
    await Promise.all([page.waitForURL((u) => u.searchParams.get('tab') === 'security', COMMIT), sections(page).getByRole('link', { name: S.security, exact: true }).click()]);
    await page.goBack();
    await page.waitForURL((u) => u.searchParams.get('tab') === 'plan', COMMIT);
    assert.equal(await sections(page).getByRole('link', { name: S.plan, exact: true }).getAttribute('aria-current'), 'page', 'back returns to the previous section');
    await page.goForward();
    await page.waitForURL((u) => u.searchParams.get('tab') === 'security', COMMIT);
    await page.reload();
    await sections(page).getByRole('link', { name: S.security, exact: true }).waitFor();
    assert.equal(await sections(page).getByRole('link', { name: S.security, exact: true }).getAttribute('aria-current'), 'page', 'a reload keeps it');
    assert.equal(await rail(page).getByRole('link', { name: TA.nav.settings, exact: true }).getAttribute('aria-current'), 'page');
  });

  test('permissions: an accountant sees only the sections that are theirs and is told about the rest', { timeout: 120_000 }, async () => {
    const accountant = await newPage(browser);
    await signIn(accountant.page, fx.accountant.email, E2E_PASSWORDS.accountant);
    const { page } = accountant;
    await page.goto('/settings');
    const names = await sections(page).getByRole('link').allTextContents();
    assert.deepEqual(names, [S.account, S.security, S.plan]);
    await page.goto('/settings?tab=data');
    await page.getByRole('status').filter({ hasText: S.data }).waitFor();
    assert.equal(await sections(page).getByRole('link', { name: S.account, exact: true }).getAttribute('aria-current'), 'page', 'falls back to the first section');
    await accountant.context.close();
  });

  test('on a phone the sections are a scrolling row and the gear is reachable from the menu', { timeout: 90_000 }, async () => {
    const phone = await newPage(browser, { width: 375, height: 800 });
    await signIn(phone.page, fx.admin.email, E2E_PASSWORDS.admin);
    const { page } = phone;
    await page.goto('/settings?tab=security');
    await page.locator('main h1').first().waitFor();
    const row = page.getByRole('region', { name: S.label });
    await row.waitFor();
    assert.equal(await row.getByRole('link', { name: S.security, exact: true }).getAttribute('aria-current'), 'page');
    assert.equal(await page.getByRole('navigation', { name: S.label, exact: true }).count(), 0, 'the vertical menu is not exposed on a phone (display:none), only the row is');
    assert.equal(await page.getByRole('link', { name: S.security, exact: true }).count(), 1, 'each section is listed once');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no sideways page scroll');
    await page.screenshot({ path: join(ARTIFACTS, 'settings-phone.png') });
    await Promise.all([page.waitForURL((u) => u.searchParams.get('tab') === 'plan', COMMIT), row.getByRole('link', { name: S.plan, exact: true }).click()]);
    await phone.context.close();
  });
});
