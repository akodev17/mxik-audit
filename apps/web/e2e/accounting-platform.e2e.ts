// Platform guarantees for the accounting modules (/onec, /bank, /didox, /products): the code step
// still guards them, their pages work on a phone and in both languages, and the 1C history API
// (docs/TASNIVO_AI_PLAN_2026-10-23.md §4.3) keeps one firm's batches and exports away from another
// and refuses mutations without the CSRF header. The API tests skip themselves while the route
// answers 404 (the module is not merged yet); the page tests run against the placeholders too.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { APIRequestContext, Browser, BrowserContext, Page } from 'playwright';
import { BASE_URL, COMMIT, db, E2E_PASSWORDS, launch, newPage, setupEmptyOrg, signIn, T, traced, type EmptyFixture } from './fixture';

const SECTIONS = ['/onec', '/bank', '/didox', '/products'] as const;
const CSRF = { 'X-Requested-With': 'tasnivo' } as const;

/** A batch and an export written straight into the shared tables (the base commit's schema). */
async function seedBatch(orgId: string): Promise<{ batchId: string; exportId: string }> {
  const batch = await db.importBatch.create({
    data: { orgId, kind: 'bank_statement', source: 'upload', filename: 'e2e-vypiska.xlsx', fingerprint: randomBytes(32).toString('hex'), status: 'review' },
    select: { id: true },
  });
  const exported = await db.oneCExport.create({ data: { batchId: batch.id, format: 'bank_exchange_1_02', filename: 'e2e.txt', recordCount: 0 }, select: { id: true } });
  return { batchId: batch.id, exportId: exported.id };
}

/** True when the route is served (anything but a route-level 404 for the owner). */
async function served(request: APIRequestContext, path: string): Promise<boolean> {
  return (await request.get(path)).status() !== 404;
}

describe('accounting modules: platform guarantees', () => {
  let a: EmptyFixture;
  let b: EmptyFixture;
  let browser: Browser;
  let sa: { context: BrowserContext; page: Page };
  let sb: { context: BrowserContext; page: Page };
  let seeded: { batchId: string; exportId: string };
  const test = (name: string, options: { timeout: number }, body: (t: TestContext) => Promise<void>) => it(name, options, traced(() => sa?.page, body));

  before(async () => {
    [a, b] = await Promise.all([setupEmptyOrg('acc-a'), setupEmptyOrg('acc-b')]);
    seeded = await seedBatch(a.orgId);
    browser = await launch();
    sa = await newPage(browser);
    sb = await newPage(browser);
    await signIn(sa.page, a.admin.email, E2E_PASSWORDS.admin);
    await signIn(sb.page, b.admin.email, E2E_PASSWORDS.admin);
  });

  after(async () => {
    await browser?.close();
    await Promise.all([a?.cleanup(), b?.cleanup()]);
  });

  test('every accounting section waits behind the e-mail code', { timeout: 90_000 }, async () => {
    const tag = randomBytes(4).toString('hex');
    const u = await setupEmptyOrg(`acc-unv-${tag}`);
    try {
      await db.user.update({ where: { id: u.admin.id }, data: { emailVerifiedAt: null } });
      const s = await newPage(browser);
      await s.page.goto('/sign-in');
      await s.page.locator('#email').fill(u.admin.email);
      await s.page.locator('#password').fill(E2E_PASSWORDS.admin);
      await Promise.all([
        s.page.waitForURL((url) => url.pathname === '/sign-up/verify', { waitUntil: 'commit', timeout: 60_000 }),
        s.page.getByRole('button', { name: T.signInAction, exact: true }).click(),
      ]);
      for (const path of SECTIONS) {
        await s.page.goto(path);
        await s.page.waitForURL((url) => url.pathname === '/sign-up/verify', COMMIT);
      }
      const api = await s.context.request.get('/api/onec/batches');
      if (api.status() !== 404) assert.equal(api.status(), 403, 'the 1C history refuses an unconfirmed user');
      await s.context.close();
    } finally {
      await u.cleanup();
    }
  });

  test('the four sections render in both languages on a 375 px phone without sideways scroll', { timeout: 120_000 }, async () => {
    const phone = await newPage(browser, { width: 375, height: 812 });
    try {
      await signIn(phone.page, a.admin.email, E2E_PASSWORDS.admin);
      const errors: string[] = [];
      phone.page.on('pageerror', (e) => errors.push(String(e)));
      for (const locale of ['uz', 'ru'] as const) {
        await phone.context.addCookies([{ name: 'mxik_locale', value: locale, url: BASE_URL }]);
        for (const path of SECTIONS) {
          const res = await phone.page.goto(path);
          assert.equal(res?.status(), 200, `${locale} ${path}`);
          await phone.page.locator('main h1').first().waitFor();
          const over = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          assert.ok(over <= 1, `${locale} ${path} scrolls sideways by ${over}px`);
          if (locale === 'ru') assert.match((await phone.page.locator('main h1').first().textContent()) ?? '', /[а-яё]/i, `${path} heading is Russian`);
        }
      }
      assert.deepEqual(errors, [], 'no page errors');
    } finally {
      await phone.context.close();
    }
  });

  test('another firm cannot read the history, a batch or an export file', { timeout: 60_000 }, async (t) => {
    const own = sa.context.request;
    if (!(await served(own, '/api/onec/batches'))) return t.skip('GET /api/onec/batches is not served yet');
    assert.equal((await own.get(`/api/onec/batches/${seeded.batchId}`)).status(), 200, 'the owner reads its batch');
    const other = sb.context.request;
    assert.equal((await other.get(`/api/onec/batches/${seeded.batchId}`)).status(), 404, 'batch of another firm');
    assert.equal((await other.get(`/api/onec/exports/${seeded.exportId}/file`)).status(), 404, 'export file of another firm');
    const list = await (await other.get('/api/onec/batches')).text();
    assert.ok(!list.includes(seeded.batchId), 'the other firm\'s history does not list the batch');
  });

  test('another firm cannot prepare, export or decide on a batch', { timeout: 60_000 }, async (t) => {
    if (!(await served(sa.context.request, '/api/onec/batches'))) return t.skip('the 1C module is not served yet');
    const other = sb.context.request;
    const format = { format: 'bank_exchange_1_02' };
    for (const path of [`/api/onec/batches/${seeded.batchId}/prepare`, `/api/onec/batches/${seeded.batchId}/export`, `/api/onec/batches/${seeded.batchId}/decisions`]) {
      const res = await other.post(path, { headers: CSRF, data: format });
      assert.ok(res.status() === 404 || (res.status() === 200 && (await res.json()).ok === false), `${path} answered ${res.status()}`);
    }
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: seeded.batchId }, select: { status: true } });
    assert.equal(batch.status, 'review', 'the batch is untouched');
    assert.equal(await db.oneCExport.count({ where: { batchId: seeded.batchId } }), 1, 'no export was added');
  });

  test('mutations without the CSRF header are refused', { timeout: 60_000 }, async (t) => {
    const own = sa.context.request;
    if (!(await served(own, '/api/onec/batches'))) return t.skip('the 1C module is not served yet');
    const res = await own.post(`/api/onec/batches/${seeded.batchId}/prepare`, { data: { format: 'bank_exchange_1_02' } });
    assert.equal(res.status(), 403);
    assert.equal((await res.json()).error?.code, 'csrf');
  });

  test('the same source cannot be imported twice into one firm', { timeout: 30_000 }, async () => {
    const fingerprint = randomBytes(32).toString('hex');
    const row = { orgId: b.orgId, kind: 'bank_statement' as const, source: 'upload', fingerprint };
    await db.importBatch.create({ data: row });
    await assert.rejects(db.importBatch.create({ data: row }), /Unique constraint/, 'the (org, kind, fingerprint) key holds');
    await db.importBatch.create({ data: { ...row, orgId: a.orgId } });
  });
});
