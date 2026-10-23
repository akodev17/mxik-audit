// The auth, team and settings forms after they moved from server actions to the API (Wave 3a):
// a refused sign-in, sign-up confirmed with the mailed code, an invite link joined from another
// browser, an API key made and revoked, a refused password change and the sessions list.
//
// The sign-up test reads the code from the API's development outbox (tmp/outbox, or
// E2E_OUTBOX_DIR): run it against an API without SMTP_URL, outside production.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import { BASE_URL, COMMIT, db, dropOrgs, E2E_PASSWORDS, launch, newPage, poll, setupFirm, signIn, T, TA, traced, type Fixture } from './fixture';

const OUTBOX = process.env['E2E_OUTBOX_DIR'] ?? join(process.cwd(), 'tmp', 'outbox');

/** The six-digit code in the newest outbox message to `to`. */
async function mailedCode(to: string): Promise<string | null> {
  const files = (await readdir(OUTBOX).catch(() => [] as string[])).sort().reverse();
  for (const file of files) {
    const text = await readFile(join(OUTBOX, file), 'utf8').catch(() => '');
    if (text.startsWith(`To: ${to}\n`)) return /\n(\d{6})\n/.exec(text)?.[1] ?? null;
  }
  return null;
}

describe('account flows on the API', () => {
  let fx: Fixture;
  let browser: Browser;
  let admin: { context: BrowserContext; page: Page };
  const joined: string[] = [];
  const signupOrgs: string[] = [];
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
    if (signupOrgs.length > 0) await dropOrgs(signupOrgs);
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

  test('sign-up: nothing opens before the mailed code; the code leads to the dashboard of a 14-day trial', { timeout: 180_000 }, async () => {
    const { context, page } = await newPage(browser);
    const email = `e2e-${fx.tag}-signup@e2e.mxik.test`;
    joined.push(email);
    await page.goto('/sign-up');
    await page.locator('input[name="firm"]').fill(`e2e ${fx.tag} firma`);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(E2E_PASSWORDS.admin);
    await Promise.all([
      page.waitForURL((u) => u.pathname === '/sign-up/verify', COMMIT),
      page.getByRole('button', { name: TA.signup.create, exact: true }).click(),
    ]);
    await page.getByRole('heading', { name: TA.verifyX.title }).waitFor();
    const user = await db.user.findUniqueOrThrow({ where: { email }, include: { org: true } });
    signupOrgs.push(user.orgId);
    assert.equal(user.emailVerifiedAt, null);
    assert.ok(user.org.trialEndsAt && user.org.trialEndsAt.getTime() - Date.now() > 13.9 * 86_400_000, '14-day trial');

    // Unconfirmed: the dashboard sends the browser back to the code step, the API refuses.
    await page.goto('/dashboard');
    await page.waitForURL((u) => u.pathname === '/sign-up/verify');
    const refused = await page.evaluate(async () => (await fetch('/api/catalogs')).status);
    assert.equal(refused, 403);

    const code = await poll('the code in the outbox', () => mailedCode(email), (c) => c !== null, 15_000, 500);
    await page.getByLabel(TA.authX.twoFactor.digit(1, 6)).click();
    await Promise.all([
      page.waitForURL((u) => u.pathname.startsWith('/dashboard'), COMMIT),
      page.keyboard.type(code ?? ''),
    ]);
    await page.locator('main h1').first().waitFor();
    assert.ok((await db.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt);
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
      // A link without an address: the member confirms theirs with the mailed code first.
      guest.page.waitForURL((u) => u.pathname === '/sign-up/verify', COMMIT),
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
    const row = page.getByRole('row').filter({ hasText: 'e2e kalit' });
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
    const first = page.getByRole('row').filter({ hasText: TA.security.current }).first();
    await first.waitFor();
  });
});
