// The firm dictionary page: filter chips with counts, who taught each entry, and the same boundaries as
// everywhere else (a scoped accountant sees nothing of it, another firm's entries never show).
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import { ARTIFACTS, db, E2E_PASSWORDS, launch, newPage, setupFirm, signIn, TA, traced, type Fixture } from './fixture';

const x = TA.wsX.dict;

describe('firm dictionary review', () => {
  let fx: Fixture;
  let browser: Browser;
  let admin: { context: BrowserContext; page: Page };
  const test = (name: string, options: { timeout: number }, body: (t: TestContext) => Promise<void>) =>
    it(name, options, traced(() => admin?.page, body));

  before(async () => {
    fx = await setupFirm('dict');
    const code = (await db.mxikCode.findFirst({ where: { retiredAt: null }, select: { code: true } }))?.code.trim() ?? '';
    const make = (orgId: string, key: string, confirmations: number, staleAt: Date | null, updatedBy: string | null) =>
      db.firmMapping.create({ data: { orgId, kind: 'name', key, label: key, code, confirmations, staleAt, updatedBy, source: confirmations > 0 ? 'manual' : 'bulk' } });
    await make(fx.orgId, 'e2e tasdiqlangan sut', 2, null, fx.accountant.id);
    await make(fx.orgId, 'e2e ommaviy non', 0, null, null);
    await make(fx.orgId, 'e2e eski kodli yogh', 1, new Date(), fx.admin.id);
    await make(fx.otherOrgId, 'e2e boshqa firma yozuvi', 4, null, fx.otherAdmin.id);
    browser = await launch();
    admin = await newPage(browser);
    await signIn(admin.page, fx.admin.email, E2E_PASSWORDS.admin);
    mkdirSync(ARTIFACTS, { recursive: true });
  });

  after(async () => {
    await browser?.close();
    await fx?.cleanup();
  });

  const chip = (page: Page, name: string) => page.getByRole('navigation', { name: x.filterLabel }).getByRole('link', { name: new RegExp(`^${name}`) });

  test('chips count each view and filter the table', { timeout: 90_000 }, async () => {
    const { page } = admin;
    await page.goto('/dictionary');
    const main = page.locator('main');
    await main.getByText('e2e tasdiqlangan sut').waitFor();
    assert.ok(((await chip(page, x.filters.all).textContent()) ?? '').includes('3'));
    assert.ok(((await chip(page, x.filters.confirmed).textContent()) ?? '').includes('1'));
    assert.ok(((await chip(page, x.filters.stale).textContent()) ?? '').includes('1'));
    assert.equal(await main.getByText('boshqa firma').count(), 0, 'another firm\'s entry is never listed');
    assert.ok(((await main.textContent()) ?? '').includes(fx.accountant.email), 'the row names who taught it');
    await page.screenshot({ path: join(ARTIFACTS, 'dictionary-review.png') });

    await chip(page, x.filters.unverified).click();
    await page.waitForURL((u) => u.searchParams.get('f') === 'unverified');
    await main.getByText('e2e ommaviy non').waitFor();
    assert.equal(await main.getByText('e2e tasdiqlangan sut').count(), 0);

    await chip(page, x.filters.stale).click();
    await page.waitForURL((u) => u.searchParams.get('f') === 'stale');
    await main.getByText('e2e eski kodli yogh').waitFor();
    assert.equal(await main.getByText('e2e ommaviy non').count(), 0);
  });

  test('an accountant limited to one client sees no dictionary', { timeout: 60_000 }, async () => {
    const scoped = await newPage(browser);
    await signIn(scoped.page, fx.accountant.email, E2E_PASSWORDS.accountant);
    await scoped.page.goto('/dictionary');
    await scoped.page.locator('main').getByText(x.scopedTitle).waitFor();
    assert.equal(await scoped.page.locator('main').getByText('e2e tasdiqlangan sut').count(), 0);
    await scoped.context.close();
  });
});
