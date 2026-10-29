// The first-login guided tour: it opens by itself on the dashboard of a user who has not seen it,
// Skip is saved on the account (a reload shows no tour), the user menu opens it again, and in Russian
// every step reads from the Russian copy.
import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import { BASE_URL, db, E2E_PASSWORDS, launch, newPage, poll, setupEmptyOrg, signIn, TA, TA_RU, traced, type EmptyFixture } from './fixture';

const tourDialog = (page: Page, label = TA.tourX.label) => page.getByRole('dialog', { name: label, exact: true });
const savedAt = async (id: string): Promise<Date | null> =>
  (await db.user.findUniqueOrThrow({ where: { id }, select: { tourCompletedAt: true } })).tourCompletedAt;

describe('onboarding tour', () => {
  let fx: EmptyFixture;
  let browser: Browser;
  let session: { context: BrowserContext; page: Page };
  const test = (name: string, options: { timeout: number }, body: (t: TestContext) => Promise<void>) => it(name, options, traced(() => session?.page, body));

  before(async () => {
    fx = await setupEmptyOrg('tour');
    // The fixture marks the tour as seen; this user is the one case that has not seen it.
    await db.user.update({ where: { id: fx.admin.id }, data: { tourCompletedAt: null } });
    browser = await launch();
    session = await newPage(browser);
  });

  after(async () => {
    await browser?.close();
    await fx?.cleanup();
  });

  test('opens once for a new user, Skip is saved, the user menu opens it again', { timeout: 60_000 }, async () => {
    const { page } = session;
    const X = TA.tourX;
    await signIn(page, fx.admin.email, E2E_PASSWORDS.admin);
    const dialog = tourDialog(page);
    await dialog.getByText(X.steps.welcome.title, { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/dashboard');
    assert.equal(await savedAt(fx.admin.id), null, 'opening the tour writes nothing');

    for (const key of ['dashboard', 'upload'] as const) {
      await dialog.getByRole('button', { name: X.next, exact: true }).click();
      await dialog.getByText(X.steps[key].title, { exact: true }).waitFor();
    }
    await dialog.getByText(X.counter(3, 14), { exact: true }).waitFor();
    await dialog.getByRole('button', { name: X.skip, exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await poll('the saved tour flag', () => savedAt(fx.admin.id), (at) => at !== null, 10_000, 250);

    await page.reload();
    await page.locator('main h1').first().waitFor();
    // Longer than the auto-start's settle time (600 ms) plus a render.
    await page.waitForTimeout(1_500);
    assert.equal(await tourDialog(page).count(), 0, 'no tour after a reload');

    const avatar = page.getByRole('button', { name: TA.shellX.user.menu, exact: true });
    await avatar.click();
    await page.getByRole('button', { name: X.menuEntry, exact: true }).click();
    await tourDialog(page).getByText(X.counter(1, 14), { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await tourDialog(page).waitFor({ state: 'hidden' });
    assert.equal(await avatar.evaluate((el) => el === document.activeElement), true, 'focus is back on the account menu');
  });

  test('in Russian every step reads from the Russian copy', { timeout: 60_000 }, async () => {
    const { page } = session;
    const X = TA_RU.tourX;
    await session.context.addCookies([{ name: 'mxik_locale', value: 'ru', url: BASE_URL }]);
    await page.goto('/settings');
    await page.locator('main h1').first().waitFor();
    // Settings → Account opens it on the dashboard.
    await page.getByRole('button', { name: X.settingsButton, exact: true }).click();
    const dialog = tourDialog(page, X.label);
    await dialog.waitFor();
    assert.equal(new URL(page.url()).pathname, '/dashboard');

    const keys = Object.keys(X.steps) as (keyof typeof X.steps)[];
    for (const [i, key] of keys.entries()) {
      await dialog.getByText(X.steps[key].title, { exact: true }).waitFor();
      await dialog.getByText(X.steps[key].body, { exact: true }).waitFor();
      await dialog.getByText(X.counter(i + 1, keys.length), { exact: true }).waitFor();
      const last = i === keys.length - 1;
      await dialog.getByRole('button', { name: last ? X.done : X.next, exact: true }).click();
    }
    await dialog.waitFor({ state: 'hidden' });
  });
});
