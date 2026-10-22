// Review tasks and the notification centre in a browser: an admin hands a catalogue to the accountant,
// who is told, sees it on the dashboard, closes it, and the admin is told in turn. A viewer cannot
// assign, and nobody reaches another firm's catalogue.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import { ARTIFACTS, COMMIT, db, E2E_PASSWORDS, launch, newPage, setupFirm, signIn, TA, traced, type Fixture } from './fixture';

const r = TA.review;
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('review assignments and notifications', () => {
  let fx: Fixture;
  let browser: Browser;
  let catalogA = '';
  let admin: { context: BrowserContext; page: Page };
  let accountant: { context: BrowserContext; page: Page };
  const test = (name: string, options: { timeout: number }, body: (t: TestContext) => Promise<void>) =>
    it(name, options, traced(() => admin?.page, body));

  before(async () => {
    fx = await setupFirm('review');
    const catalog = await db.catalog.create({
      data: {
        orgId: fx.orgId, clientId: fx.clientA.id, filename: `mijoz-a-${fx.tag}.xlsx`, rowCount: 1, status: 'ready',
        headers: ['Mahsulot', 'IKPU'], columnMap: { name: 0, barcode: -1, mxik: 1, unit: -1, price: -1, sales: -1 },
      },
    });
    catalogA = catalog.id;
    browser = await launch();
    admin = await newPage(browser);
    accountant = await newPage(browser);
    await signIn(admin.page, fx.admin.email, E2E_PASSWORDS.admin);
    await signIn(accountant.page, fx.accountant.email, E2E_PASSWORDS.accountant);
    mkdirSync(ARTIFACTS, { recursive: true });
  });

  after(async () => {
    await browser?.close();
    await fx?.cleanup();
  });

  const field = (page: Page) => page.locator('dl').filter({ hasText: `${r.field}:` }).first();

  test('an admin hands the catalogue to the accountant from its header', { timeout: 90_000 }, async () => {
    const { page } = admin;
    await page.goto(`/catalogs/${catalogA}`);
    await page.getByRole('button', { name: r.assign, exact: true }).click();
    await page.getByLabel(r.assignee).selectOption({ label: fx.accountant.email });
    await page.getByLabel(r.due).fill(day(3));
    await page.getByLabel(r.note).fill('Oylik tekshiruv, iltimos tez');
    await page.screenshot({ path: join(ARTIFACTS, 'review-assign-popover.png') });
    await page.getByRole('button', { name: r.save, exact: true }).click();
    await page.getByText(r.saved, { exact: true }).waitFor();
    // The page refreshes after the toast; wait for the header to catch up.
    await field(page).getByText(fx.accountant.email).waitFor();
    await field(page).getByText(r.open, { exact: true }).waitFor();
    assert.equal(await db.reviewAssignment.count({ where: { orgId: fx.orgId, catalogId: catalogA } }), 1);
  });

  test('a person outside the client scope cannot be chosen', { timeout: 60_000 }, async () => {
    const { page } = admin;
    await page.goto(`/catalogs/${fx.clientBCatalogId}`);
    await page.getByRole('button', { name: r.assign, exact: true }).click();
    const options = await page.getByLabel(r.assignee).locator('option').allTextContents();
    assert.ok(!options.includes(fx.accountant.email), 'the accountant limited to client A is not offered for client B');
    assert.ok(!options.includes(fx.viewer.email), 'a viewer is never offered');
    assert.ok(options.includes(fx.admin.email));
  });

  test('the accountant is told, sees it on the dashboard and in the notification centre', { timeout: 90_000 }, async () => {
    const { page } = accountant;
    await page.goto('/notifications');
    const title = r.dash.title; // present on the dashboard only; the notice itself is worded by the server
    await page.getByRole('heading', { name: new RegExp(fx.clientA.name) }).first().waitFor();
    const body = (await page.locator('main').textContent()) ?? '';
    assert.ok(body.includes(fx.clientA.name), 'the notice names the client');
    assert.ok(body.includes('Oylik tekshiruv, iltimos tez'), 'and carries the note');

    // The admin did not get a notice meant for the accountant.
    await admin.page.goto('/notifications');
    await admin.page.locator('main h1').first().waitFor();
    assert.ok(!((await admin.page.locator('main').textContent()) ?? '').includes('Oylik tekshiruv, iltimos tez'), 'a personal notice stays personal');

    await page.goto('/dashboard');
    const region = page.getByRole('region', { name: title });
    await region.waitFor();
    assert.ok(((await region.textContent()) ?? '').includes(fx.clientA.name));
    await page.screenshot({ path: join(ARTIFACTS, 'review-dashboard.png') });
    await region.getByRole('link', { name: r.dash.mine }).click();
    await page.waitForURL((url) => url.searchParams.get('rv') === 'mine', COMMIT);
  });

  test('the accountant closes it and the admin is told', { timeout: 90_000 }, async () => {
    const { page } = accountant;
    await page.goto(`/catalogs/${catalogA}`);
    await page.getByRole('button', { name: r.change, exact: true }).click();
    await page.getByLabel(r.doneNote).fill('Tekshirildi');
    await page.getByRole('button', { name: r.markDone, exact: true }).click();
    await page.getByText(r.markedDone, { exact: true }).waitFor();
    await field(page).getByText(r.done, { exact: true }).waitFor();
    assert.equal((await db.reviewAssignment.findUnique({ where: { catalogId: catalogA } }))?.status, 'done');

    await admin.page.goto('/notifications?topic=review');
    await admin.page.getByRole('heading', { name: new RegExp(fx.clientA.name) }).first().waitFor();
    assert.ok(((await admin.page.locator('main').textContent()) ?? '').includes('Tekshirildi'));
  });

  test('a viewer sees the state but has no way to assign; another firm sees nothing', { timeout: 90_000 }, async () => {
    const viewer = await newPage(browser);
    await signIn(viewer.page, fx.viewer.email, E2E_PASSWORDS.viewer);
    await viewer.page.goto(`/catalogs/${catalogA}`);
    await field(viewer.page).waitFor();
    assert.equal(await viewer.page.getByRole('button', { name: r.assign, exact: true }).count(), 0);
    assert.equal(await viewer.page.getByRole('button', { name: r.change, exact: true }).count(), 0);
    await viewer.context.close();

    const other = await newPage(browser);
    await signIn(other.page, fx.otherAdmin.email, E2E_PASSWORDS.otherAdmin);
    // The (app) segment streams, so the status is 200 and the page says it does not exist.
    await other.page.goto(`/catalogs/${catalogA}`);
    await other.page.locator('main').getByRole('heading', { name: TA.shellX.notFound.title }).waitFor();
    await other.context.close();

    // The accountant cannot open a client they are not assigned to either.
    await accountant.page.goto(`/catalogs/${fx.clientBCatalogId}`);
    await accountant.page.locator('main').getByRole('heading', { name: TA.shellX.notFound.title }).waitFor();
  });
});
