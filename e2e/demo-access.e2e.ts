// Demo access in a browser: the request form, the e-mailed link (used once, opened only by a button),
// the 30-minute idle limit and the fixed end, enforced by the server. The link is requested through the
// library (the test process shares the database with the server) because no mail server is involved.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import { requestDemoAccess } from '../src/lib/demo-access';
import { dropOrgs, liveCodes, makeCatalog, makeOrg } from '../src/lib/test-fixtures';
import { ARTIFACTS, COMMIT, db, launch, newPage, T, TA, traced } from './fixture';

const tag = (): string => Math.random().toString(16).slice(2, 10);
const DA = T.demoAccess;
const email = (): string => `ali-${tag()}@e2e-demo.example`;

describe('demo access by e-mail', () => {
  let browser: Browser;
  let session: { context: BrowserContext; page: Page };
  let templateOrg = '';
  let customerOrg = '';
  let customerCatalog = '';
  const demoEmails: string[] = [];
  const test = (name: string, options: { timeout: number }, body: (t: TestContext) => Promise<void>) => it(name, options, traced(() => session?.page, body));

  /** A link as the e-mail would carry it. */
  const linkFor = async (address = email()): Promise<string> => {
    demoEmails.push(address);
    const result = await requestDemoAccess(
      { name: 'Ali Valiyev', company: 'E2E MChJ', email: address, useCase: 'evaluation' },
      { ip: `e2e-demo-${tag()}`, mail: { subject: 's', body: (l) => l } },
    );
    assert.ok(result.ok && result.link, 'a link is issued');
    return new URL(result.link, 'http://x').pathname;
  };

  before(async () => {
    delete process.env['SMTP_URL'];
    const code = (await liveCodes(1))[0] ?? null;
    templateOrg = (await makeOrg('demo_template')).orgId;
    await makeCatalog(templateOrg, [{ rawName: 'E2E demo guruch', suggestedMxik: code, confidence: 0.9 }]);
    const customer = await makeOrg('customer');
    customerOrg = customer.orgId;
    customerCatalog = (await makeCatalog(customerOrg, [{ rawName: 'E2E real customer row', suggestedMxik: code, confidence: 0.8 }])).catalogId;
    browser = await launch();
    session = await newPage(browser);
    mkdirSync(ARTIFACTS, { recursive: true });
  });

  after(async () => {
    await browser?.close();
    const demoOrgs = await db.demoRequest.findMany({ where: { email: { in: demoEmails } }, select: { orgId: true } });
    await dropOrgs([templateOrg, customerOrg, ...demoOrgs.flatMap((r) => (r.orgId ? [r.orgId] : []))]);
    await db.demoRequest.deleteMany({ where: { email: { endsWith: '@e2e-demo.example' } } });
    await db.authAttempt.deleteMany({ where: { kind: { in: ['demo_req_ip', 'demo_req_email', 'demo_verify_ip'] } } });
  });

  test('the demo page asks for details instead of opening a demo', { timeout: 90_000 }, async () => {
    const { page } = session;
    await page.goto('/demo');
    await page.getByLabel(DA.name).waitFor();
    assert.equal(await page.getByRole('button', { name: T.demoStart }).count(), 0, 'there is no one-click start any more');

    // A throwaway address is refused on the spot, in words.
    await page.getByLabel(DA.name).fill('Ali Valiyev');
    await page.getByLabel(DA.company).fill('E2E MChJ');
    await page.getByLabel(DA.email).fill(`x-${tag()}@mailinator.com`);
    await page.getByLabel(DA.useCase).selectOption('evaluation');
    await page.getByRole('button', { name: DA.submit }).click();
    await page.getByText(DA.errors.disposable).waitFor();

    // A real address gets the "check your e-mail" answer and nothing opens.
    const address = email();
    demoEmails.push(address);
    await page.getByLabel(DA.email).fill(address);
    await page.screenshot({ path: join(ARTIFACTS, 'demo-request-form.png') });
    await page.getByRole('button', { name: DA.submit }).click();
    await page.getByText(DA.sentTitle).waitFor();
    assert.equal(await db.demoRequest.count({ where: { email: address, verifiedAt: null } }), 1);
    assert.equal(new URL(page.url()).pathname, '/demo');
  });

  test('a signed-out visitor cannot reach the demo without the link', { timeout: 60_000 }, async () => {
    const { page } = session;
    await page.goto('/dashboard');
    await page.waitForURL((u) => u.pathname.startsWith('/sign-in'), COMMIT);
  });

  test('the link opens a demo once, and only when the button is pressed', { timeout: 120_000 }, async () => {
    const path = await linkFor();
    const first = await newPage(browser);
    await first.page.goto(path);
    await first.page.getByRole('button', { name: DA.open }).waitFor();
    await first.page.reload();
    await first.page.getByRole('button', { name: DA.open }).waitFor();
    assert.equal(await db.demoRequest.count({ where: { verifiedAt: { not: null }, email: { in: demoEmails.slice(-1) } } }), 0, 'looking at the page does not use the link');
    await first.page.screenshot({ path: join(ARTIFACTS, 'demo-verify-page.png') });
    await Promise.all([first.page.waitForURL((u) => u.pathname.startsWith('/catalogs'), COMMIT), first.page.getByRole('button', { name: DA.open }).click()]);
    await first.page.locator('main').first().waitFor();
    // The product is intact: top navigation and sidebar.
    assert.ok(await first.page.getByRole('navigation').count() >= 2);

    // The same link, anywhere else, is dead.
    const other = await newPage(browser);
    await other.page.goto(path);
    await other.page.getByRole('heading', { name: DA.invalidTitle }).waitFor();
    assert.equal(await other.page.getByRole('button', { name: DA.open }).count(), 0);
    await other.context.close();

    // The demo copy is private: another organisation's catalogue is simply not there.
    await first.page.goto(`/catalogs/${customerCatalog}`);
    await first.page.locator('main').getByRole('heading', { name: TA.shellX.notFound.title }).waitFor();
    assert.ok(!((await first.page.locator('main').textContent()) ?? '').includes('E2E real customer row'), 'no data of a real org is shown');
    await first.context.close();
  });

  test('the server ends a demo after 30 idle minutes', { timeout: 120_000 }, async () => {
    const path = await linkFor();
    const demo = await newPage(browser);
    await demo.page.goto(path);
    await Promise.all([demo.page.waitForURL((u) => u.pathname.startsWith('/catalogs'), COMMIT), demo.page.getByRole('button', { name: DA.open }).click()]);
    const row = await db.demoRequest.findFirstOrThrow({ where: { email: demoEmails[demoEmails.length - 1] ?? '' }, select: { orgId: true } });
    await db.userSession.updateMany({ where: { orgId: row.orgId ?? '' }, data: { lastSeenAt: new Date(Date.now() - 29 * 60_000) } });
    await demo.page.goto('/dashboard');
    await demo.page.locator('main h1').first().waitFor();
    await db.userSession.updateMany({ where: { orgId: row.orgId ?? '' }, data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    await demo.page.goto('/dashboard');
    await demo.page.waitForURL((u) => u.pathname.startsWith('/sign-in'), COMMIT);
    await demo.context.close();
  });

  test('the server ends a demo at its fixed end, whatever the cookie says', { timeout: 120_000 }, async () => {
    const path = await linkFor();
    const demo = await newPage(browser);
    await demo.page.goto(path);
    await Promise.all([demo.page.waitForURL((u) => u.pathname.startsWith('/catalogs'), COMMIT), demo.page.getByRole('button', { name: DA.open }).click()]);
    const row = await db.demoRequest.findFirstOrThrow({ where: { email: demoEmails[demoEmails.length - 1] ?? '' }, select: { orgId: true } });
    await db.organization.update({ where: { id: row.orgId ?? '' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const api = await demo.page.request.get('/api/export?catalog=anything', { failOnStatusCode: false });
    assert.equal(api.status(), 401, 'the API treats the expired demo as signed out');
    await demo.page.goto('/dashboard');
    await demo.page.waitForURL((u) => u.pathname.startsWith('/sign-in'), COMMIT);
    await demo.context.close();
  });
});
