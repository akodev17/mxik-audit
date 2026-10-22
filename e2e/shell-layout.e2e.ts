// The signed-in frame at the four widths the UI is checked at (1440, 1024, 768, 375): both navigation
// areas from md, every header destination reachable (tabs that do not fit move into the "more" menu
// instead of scrolling out of sight), rail tooltips that do not cover the next icon, and a phone
// header that keeps the account menu on screen with a long client name.
import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import { db } from '../src/lib/db';
import { COMMIT, E2E_PASSWORDS, launch, newPage, setupFirm, signIn, TA, traced, type Fixture } from './fixture';

const DESKTOP = [1440, 1024, 768];
// Settings is not a header tab: it is the gear in the left rail.
const HEADER_TABS = ['/dashboard', '/queue', '/clients', '/team', '/catalogs', '/dictionary', '/activity'];

const headerNav = (page: Page) => page.getByRole('navigation', { name: TA.shellX.nav.label, exact: true });
const rail = (page: Page) => page.getByRole('navigation', { name: TA.shellX.nav.utilities, exact: true });

async function noSidewaysScroll(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow, 0, `${where}: the page does not scroll sideways`);
}

describe('app shell layout', () => {
  let fx: Fixture;
  let browser: Browser;
  let session: { context: BrowserContext; page: Page };
  const test = (name: string, options: { timeout: number }, body: (t: TestContext) => Promise<void>) => it(name, options, traced(() => session?.page, body));

  before(async () => {
    fx = await setupFirm('shell');
    // A client name as long as real ones get, so the phone header has to truncate it.
    await db.client.update({ where: { id: fx.clientA.id }, data: { name: `Mas'uliyati cheklangan jamiyat Pilot Stroy Audit ${fx.tag}` } });
    browser = await launch();
    session = await newPage(browser);
    await signIn(session.page, fx.admin.email, E2E_PASSWORDS.admin);
  });

  after(async () => {
    await browser?.close();
    await fx?.cleanup();
  });

  test('21 from md the header tabs and the left sidebar both show, with their own names, and every tab is on screen or in the more menu', { timeout: 120_000 }, async () => {
    const { page } = session;
    for (const width of DESKTOP) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/dashboard');
      await page.locator('main h1').first().waitFor();
      await assert.doesNotReject(headerNav(page).waitFor(), `${width}: header tabs`);
      await assert.doesNotReject(rail(page).waitFor(), `${width}: left sidebar`);
      const railBox = await rail(page).boundingBox();
      const mainBox = await page.locator('main').boundingBox();
      assert.ok(railBox && mainBox && railBox.x + railBox.width <= mainBox.x + 0.5, `${width}: the sidebar sits beside the page, not over it`);

      const navBox = await headerNav(page).boundingBox();
      assert.ok(navBox);
      const visible: string[] = [];
      for (const link of await headerNav(page).locator('ul a').all()) {
        const box = await link.boundingBox();
        assert.ok(box && box.x >= navBox.x - 0.5 && box.x + box.width <= navBox.x + navBox.width + 0.5, `${width}: tab ${await link.textContent()} is not clipped`);
        visible.push((await link.getAttribute('href')) ?? '');
      }
      const more = headerNav(page).getByRole('button', { name: TA.shellX.nav.more, exact: true });
      const inMenu: string[] = [];
      if (visible.length < HEADER_TABS.length) {
        await more.click();
        for (const item of await page.getByRole('menuitem').all()) inMenu.push((await item.getAttribute('href')) ?? '');
        await page.keyboard.press('Escape');
      } else {
        assert.equal(await more.count(), 0, `${width}: no more menu when every tab fits`);
      }
      assert.deepEqual([...visible, ...inMenu], HEADER_TABS, `${width}: every destination once, in order`);
      await noSidewaysScroll(page, `${width} dashboard`);
    }
  });

  test('22 a section that sits in the more menu is marked current there and opens from it', { timeout: 90_000 }, async () => {
    const { page } = session;
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto('/activity');
    await page.locator('main h1').first().waitFor();
    await headerNav(page).getByRole('button', { name: TA.shellX.nav.more, exact: true }).click();
    const activity = page.getByRole('menuitem', { name: TA.nav.activity });
    assert.equal(await activity.getAttribute('aria-current'), 'page');
    const dictionary = page.getByRole('menuitem', { name: TA.nav.dictionary });
    await Promise.all([page.waitForURL((url) => url.pathname === '/dictionary', COMMIT), dictionary.click()]);
    await page.locator('main h1').first().waitFor();
  });

  test('23 rail tooltips open beside the icon, so the next icon stays clickable', { timeout: 90_000 }, async () => {
    const { page } = session;
    for (const width of DESKTOP) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/dashboard');
      const bell = rail(page).getByRole('link', { name: TA.shellX.bell.title });
      const help = rail(page).getByRole('link', { name: TA.shellX.nav.help });
      await bell.hover();
      const tip = rail(page).getByRole('tooltip').filter({ hasText: TA.shellX.bell.title });
      await tip.waitFor();
      const tipBox = await tip.locator('span').first().boundingBox();
      const helpBox = await help.boundingBox();
      const bellBox = await bell.boundingBox();
      assert.ok(tipBox && helpBox && bellBox);
      assert.ok(tipBox.x >= bellBox.x + bellBox.width - 0.5, `${width}: the tooltip is to the right of the icon`);
      assert.ok(tipBox.x >= 0 && tipBox.y + tipBox.height <= 900, `${width}: the tooltip is inside the window`);
      // The way a person moves: straight down from the bell onto help, then click (no forced click).
      await Promise.all([page.waitForURL((url) => url.pathname.startsWith('/yordam'), COMMIT), help.click()]);
    }
  });

  test('24 on a phone a long client name truncates and the account menu stays on screen', { timeout: 90_000 }, async () => {
    const { page } = session;
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/clients/${fx.clientA.id}`);
      await page.locator('main h1').first().waitFor();
      assert.equal(await headerNav(page).isVisible(), false, `${width}: the tabs move into the menu button`);
      for (const control of await page.locator('header a, header button').all()) {
        if (!(await control.isVisible())) continue;
        const box = await control.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width + 0.5, `${width}: ${await control.getAttribute('aria-label')} is inside the header`);
      }
      const account = page.getByRole('button', { name: TA.shellX.user.menu });
      await account.click();
      await page.getByRole('dialog', { name: TA.shellX.user.menu }).waitFor();
      await page.keyboard.press('Escape');
      await noSidewaysScroll(page, `${width} client page`);
    }
  });
});
