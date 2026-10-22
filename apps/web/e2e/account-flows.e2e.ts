// The auth, team and settings forms after they moved from server actions to the API (Wave 3a):
// a refused sign-in, an invite link joined from another browser, an API key made and revoked,
// a refused password change and the sessions list.
import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import { BASE_URL, COMMIT, db, E2E_PASSWORDS, launch, newPage, setupFirm, signIn, T, TA, traced, type Fixture } from './fixture';

describe('account flows on the API', () => {
  let fx: Fixture;
  let browser: Browser;
  let admin: { context: BrowserContext; page: Page };
  const joined: string[] = [];
  const test = (name: string, options: { timeout: number }, body: (t: TestContext) => Promise<void>) => it(name, options, traced(() => admin?.page, body));

  before(async () => {
    fx = await setupFirm('accountflows');
    browser = await launch();
    admin = await newPage(browser);
    await signIn(admin.page, fx.admin.email, E2E_PASSWORDS.admin);
  });

  after(async () => {
    await browser?.close();
    if (joined.length > 0) await db.user.deleteMany({ where: { email: { in: joined } } });
    await fx?.cleanup();
  });

  test('a wrong password is refused in the form; the address stays, the password is cleared', { timeout: 90_000 }, async () => {
    const { context, page } = await newPage(browser);
    await page.goto('/sign-in');
    await page.locator('#email').fill(fx.viewer.email);
    await page.locator('#password').fill('not-the-password');
    await page.getByRole('button', { name: T.signInAction, exact: true }).click();
    await page.locator('main form').getByRole('alert').waitFor();
    assert.equal(await page.locator('#email').inputValue(), fx.viewer.email);
    assert.equal(await page.locator('#password').inputValue(), '');
    assert.equal(new URL(page.url()).pathname, '/sign-in');
    await context.close();
  });

  test('an invite link is created, joined from another browser and leaves the pending list', { timeout: 180_000 }, async () => {
    const { page } = admin;
    const s = TA.setX.team;
    await page.goto('/team');
    await page.getByRole('button', { name: s.inviteCta, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('label').filter({ hasText: s.invite.byLink }).click();
    await dialog.getByRole('button', { name: s.invite.submit, exact: true }).click();
    const link = await dialog.getByLabel(s.invite.link, { exact: true }).inputValue();
    assert.match(link, /\/invite\/[\w-]+$/);
    await page.keyboard.press('Escape');
    await page.getByRole('main').getByText(s.pending.noEmail).first().waitFor();

    const guest = await newPage(browser);
    const email = `e2e-${fx.tag}-joined@e2e.mxik.test`;
    joined.push(email);
    await guest.page.goto(new URL(link, BASE_URL).pathname);
    await guest.page.locator('input[name="email"]').fill(email);
    await guest.page.locator('input[name="password"]').fill(E2E_PASSWORDS.viewer);
    await Promise.all([
      guest.page.waitForURL((u) => u.pathname.startsWith('/catalogs'), COMMIT),
      guest.page.getByRole('button', { name: TA.team.join, exact: true }).click(),
    ]);
    await guest.context.close();

    await page.reload();
    await page.getByRole('main').getByText(email).first().waitFor();
    assert.equal(await page.getByRole('main').getByText(s.pending.noEmail).count(), 0, 'the used link is no longer pending');
  });

  test('an API key is shown once, listed, and revoked', { timeout: 120_000 }, async () => {
    const { page } = admin;
    const s = TA.setX.integrations;
    await page.goto('/settings?tab=integrations');
    await page.getByLabel(s.keyName, { exact: true }).fill('e2e kalit');
    await page.getByRole('button', { name: s.create, exact: true }).click();
    const token = await page.getByLabel(s.newKey, { exact: true }).inputValue();
    assert.match(token, /^mxk_/);
    const row = page.getByRole('listitem').filter({ hasText: 'e2e kalit' });
    await row.waitFor();
    await row.getByRole('button', { name: s.revoke, exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: s.revokeConfirm, exact: true }).click();
    await row.getByText(s.revoked, { exact: true }).waitFor();
  });

  test('security: a wrong current password is refused; this browser leads the sessions list', { timeout: 120_000 }, async () => {
    const { page } = admin;
    const p = TA.secX.password;
    await page.goto('/settings?tab=security');
    await page.getByLabel(p.current, { exact: true }).fill('not-the-password');
    await page.getByLabel(p.next, { exact: true }).fill('e2e-local-NewPass-1a!');
    await page.getByRole('button', { name: p.submit, exact: true }).click();
    const form = page.locator('form').filter({ has: page.getByLabel(p.current, { exact: true }) });
    await form.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel(p.current, { exact: true }).inputValue(), '', 'the form is cleared after the attempt');
    const first = page.getByRole('listitem').filter({ hasText: TA.security.current }).first();
    await first.waitFor();
  });
});
