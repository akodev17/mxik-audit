// End-to-end setup helper. Every *.e2e.ts file creates its own throwaway org
// (and a second org for the isolation checks) through Prisma, drives the
// already running server with the Playwright library, and deletes everything
// it created at the end: deleting an organization cascades to its users,
// clients, catalogues, findings and audit events.
//
// Runs against E2E_BASE_URL (default http://localhost:3000). Nothing here
// starts, stops or builds a server.
import assert from 'node:assert/strict';
import '@tasnivo/domain/load-env';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import ExcelJS from 'exceljs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { db } from '@tasnivo/db';
import { uz } from '@tasnivo/i18n/i18n';
import { taUz } from '@tasnivo/i18n/i18n-app';
import { hashPassword } from '@tasnivo/domain/password';
import { attemptKey } from '@tasnivo/domain/security/rate-limit';

export const BASE_URL = (process.env['E2E_BASE_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');

/** Uzbek Latin is the default interface language; the suite reads its copy from the app's own dictionaries. */
export const T = uz;
export const TA = taUz;

// ---------------------------------------------------------------------------
// LOCAL E2E TEST CREDENTIALS. Only for the throwaway users this suite creates
// in its own test orgs and deletes when the file finishes. Not real accounts,
// never valid anywhere else, never printed by the suite.
// ---------------------------------------------------------------------------
export const E2E_PASSWORDS = {
  admin: 'e2e-local-Admin-9f3c!',
  accountant: 'e2e-local-Accountant-4b7d!',
  viewer: 'e2e-local-Viewer-2e8a!',
  otherAdmin: 'e2e-local-OtherOrg-6c1f!',
} as const;

/**
 * Every browser of one test file reports this address. Sign-in attempts are
 * rate limited per client address (src/lib/security/rate-limit.ts); a per-run
 * address keeps repeated local runs from sharing one bucket, and lets the
 * cleanup remove exactly the attempt rows this run wrote.
 */
export const RUN_IP = `e2e-${randomBytes(6).toString('hex')}`;

export type Fixture = {
  tag: string;
  orgId: string;
  otherOrgId: string;
  admin: { id: string; email: string };
  accountant: { id: string; email: string };
  viewer: { id: string; email: string };
  otherAdmin: { id: string; email: string };
  clientA: { id: string; name: string };
  clientB: { id: string; name: string };
  /** A ready catalogue of client B, made directly in the database (the accountant must not see it). */
  clientBCatalogId: string;
  /** A ready catalogue of the second org. */
  otherCatalogId: string;
  cleanup: () => Promise<void>;
};

const emailFor = (tag: string, who: string): string => `e2e-${tag}-${who}@e2e.mxik.test`;

/** One audited-looking catalogue with one row and one finding, without running the audit. */
async function directCatalog(orgId: string, clientId: string, filename: string, product: string): Promise<string> {
  const catalog = await db.catalog.create({
    data: {
      orgId, clientId, filename, rowCount: 1, status: 'ready',
      // Header names no uploaded test file uses, so this catalogue's remembered mapping never applies to them.
      headers: ['Mahsulot', 'IKPU'], columnMap: { name: 0, barcode: -1, mxik: 1, unit: -1, price: -1, sales: -1 },
    },
  });
  const item = await db.catalogItem.create({
    data: { catalogId: catalog.id, rowIndex: 0, rawName: product, normalizedName: product.toLowerCase(), attrs: { original: [product, ''] } },
  });
  await db.finding.create({ data: { itemId: item.id, type: 'MISSING', severity: 'high', suggestedMxik: null, confidence: null, alternatives: [], reason: 'e2e fixture' } });
  return catalog.id;
}

async function removeOrgs(orgIds: string[], emails: string[]): Promise<void> {
  if (orgIds.length > 0) {
    await db.$executeRaw`DELETE FROM rerank_cache WHERE scope = ANY(${orgIds})`;
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  }
  // Attempt rows are keyed by hashes of the address and the e-mails; only this run's are removed.
  await db.authAttempt.deleteMany({ where: { key: { in: [RUN_IP, ...emails].map(attemptKey) } } });
}

/**
 * The firm under test: an admin, an accountant limited to client A, a viewer
 * (all clients), clients A and B, and a second org with its own admin and
 * catalogue. Orgs are kind "internal" (test orgs: no plan limits, never counted
 * as customers).
 */
export async function setupFirm(label: string): Promise<Fixture> {
  const tag = `${label}-${randomBytes(4).toString('hex')}`;
  const orgIds: string[] = [];
  const emails: string[] = [];
  try {
    const verified = new Date();
    const org = await db.organization.create({ data: { name: `E2E firma ${tag}`, kind: 'internal' } });
    orgIds.push(org.id);
    const other = await db.organization.create({ data: { name: `E2E boshqa firma ${tag}`, kind: 'internal' } });
    orgIds.push(other.id);

    const user = async (orgId: string, who: string, role: 'admin' | 'accountant' | 'viewer', password: string) => {
      const email = emailFor(tag, who);
      emails.push(email);
      const created = await db.user.create({
        data: { orgId, email, role, passwordHash: await hashPassword(password), emailVerifiedAt: verified, locale: 'uz' },
        select: { id: true, email: true },
      });
      return created;
    };
    const admin = await user(org.id, 'admin', 'admin', E2E_PASSWORDS.admin);
    const accountant = await user(org.id, 'accountant', 'accountant', E2E_PASSWORDS.accountant);
    const viewer = await user(org.id, 'viewer', 'viewer', E2E_PASSWORDS.viewer);
    const otherAdmin = await user(other.id, 'other-admin', 'admin', E2E_PASSWORDS.otherAdmin);

    const clientA = await db.client.create({ data: { orgId: org.id, name: `E2E Mijoz A ${tag}`, activity: 'savdo' }, select: { id: true, name: true } });
    const clientB = await db.client.create({ data: { orgId: org.id, name: `E2E Mijoz B ${tag}` }, select: { id: true, name: true } });
    await db.clientAssignment.create({ data: { userId: accountant.id, clientId: clientA.id } });
    const otherClient = await db.client.create({ data: { orgId: other.id, name: `E2E Boshqa mijoz ${tag}` }, select: { id: true } });

    const clientBCatalogId = await directCatalog(org.id, clientB.id, `mijoz-b-${tag}.xlsx`, 'Mijoz B tovari');
    const otherCatalogId = await directCatalog(other.id, otherClient.id, `boshqa-firma-${tag}.xlsx`, 'Boshqa firma tovari');

    return {
      tag, orgId: org.id, otherOrgId: other.id, admin, accountant, viewer, otherAdmin, clientA, clientB,
      clientBCatalogId, otherCatalogId,
      cleanup: () => removeOrgs(orgIds, emails),
    };
  } catch (error) {
    await removeOrgs(orgIds, emails).catch(() => undefined);
    throw error;
  }
}

export type EmptyFixture = { tag: string; orgId: string; admin: { id: string; email: string }; cleanup: () => Promise<void> };

/** A brand-new firm as signup leaves it: one admin, no clients, no catalogues. */
export async function setupEmptyOrg(label: string): Promise<EmptyFixture> {
  const tag = `${label}-${randomBytes(4).toString('hex')}`;
  const email = emailFor(tag, 'admin');
  const org = await db.organization.create({ data: { name: `E2E yangi firma ${tag}`, kind: 'internal' } });
  try {
    const admin = await db.user.create({
      data: { orgId: org.id, email, role: 'admin', passwordHash: await hashPassword(E2E_PASSWORDS.admin), emailVerifiedAt: new Date(), locale: 'uz' },
      select: { id: true, email: true },
    });
    return { tag, orgId: org.id, admin, cleanup: () => removeOrgs([org.id], [email]) };
  } catch (error) {
    await removeOrgs([org.id], [email]).catch(() => undefined);
    throw error;
  }
}

// ------------------------------------------------------------------ browser

export async function launch(): Promise<Browser> {
  // E2E_CHANNEL=msedge drives an installed Edge where Playwright's own Chromium is not downloaded.
  const channel = process.env['E2E_CHANNEL'];
  return chromium.launch({ headless: process.env['E2E_HEADED'] !== '1', ...(channel ? { channel } : {}) });
}

/**
 * Navigation watchdog warnings seen in this file's browser pages; any of them fails the test. With
 * E2E_NO_NAV_FALLBACK=1 the watchdog (src/ui/shell/same-route-links.ts) also skips its document
 * load, so a navigation that never commits cannot be rescued that way either.
 */
export const navigationWarnings: string[] = [];
const noNavigationFallback = process.env['E2E_NO_NAV_FALLBACK'] === '1';

/** A fresh browser profile: Uzbek, light theme, desktop width, this run's client address. */
export async function newPage(browser: Browser, viewport = { width: 1440, height: 900 }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport,
    locale: 'uz-UZ',
    timezoneId: 'Asia/Tashkent',
    acceptDownloads: true,
    extraHTTPHeaders: { 'x-real-ip': RUN_IP },
  });
  await context.addCookies([
    { name: 'mxik_locale', value: 'uz', url: BASE_URL },
    { name: 'mxik_theme', value: 'light', url: BASE_URL },
  ]);
  if (noNavigationFallback) await context.addInitScript(() => { (window as unknown as { __mxikNavigationFallback?: boolean }).__mxikNavigationFallback = false; });
  context.on('console', (message) => {
    if (message.type() === 'warning' && message.text().startsWith('[navigation]')) navigationWarnings.push(message.text());
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(60_000);
  return { context, page };
}

/** Signs in through the real form and waits for the dashboard. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname.startsWith('/dashboard'), COMMIT_60S),
    page.getByRole('button', { name: T.signInAction, exact: true }).click(),
  ]);
  await page.locator('main h1').first().waitFor();
}

/**
 * Server-action redirects and router links are client-side navigations: they
 * have no load event to wait for. Callers wait for the URL, then for content.
 */
export const COMMIT = { waitUntil: 'commit' } as const;
const COMMIT_60S = { waitUntil: 'commit', timeout: 60_000 } as const;

/** The workspace grid's finding rows currently in the DOM (the grid is virtualised). */
export const gridRows = (page: Page) => page.locator('[role="grid"] [role="row"][id^="ws-row-"]');

/** The finding id behind a grid row element id. */
export const findingIdOf = (domId: string | null): string | null => (domId?.startsWith('ws-row-') ? domId.slice('ws-row-'.length) : null);

/** Value of a KPI tile (src/ui/stat.tsx) by its label. */
export async function statValue(page: Page, label: string): Promise<string | null> {
  return page.evaluate((wanted) => {
    for (const span of Array.from(document.querySelectorAll('main [data-stat-label]'))) {
      if (span.textContent?.trim() !== wanted) continue;
      const tile = span.parentElement?.parentElement;
      const value = tile?.querySelector('.text-title');
      if (value) return value.textContent?.trim() ?? null;
    }
    return null;
  }, label);
}

/**
 * Text with thousands separators removed. Numbers formatted in the browser follow the
 * browser's ICU data ("3,000" in headless Chromium) while the suite's copy is formatted
 * by Node ("3 000"), so copy that contains numbers is compared without separators.
 */
export const plainNumbers = (text: string): string => text.replace(/(\d)[\s,.  ](?=\d{3}(?!\d))/g, '$1');

/** Digits of a formatted number ("1 234" in uz). */
export const digits = (text: string | null): number => Number((text ?? '').replace(/\D/g, ''));

// --------------------------------------------------------------- spreadsheets

export type Cell = string | number | null;

/** An .xlsx file in memory. Codes are written as text, as an accountant's export keeps them. */
export async function xlsxFile(headers: string[], rows: Cell[][], sheet = 'Katalog'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(sheet);
  ws.addRow(headers);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** First sheet of an .xlsx as rows of trimmed strings. */
export async function readXlsx(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = workbook.worksheets[0];
  const out: string[][] = [];
  ws?.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    out.push(values.map((v) => (v === null || v === undefined ? '' : typeof v === 'object' && 'text' in v ? String(v.text) : String(v)).trim()));
  });
  return out;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ------------------------------------------------------------------ failures

/** Where failure screenshots go (outside the repository). */
export const ARTIFACTS = process.env['E2E_ARTIFACTS'] ?? join(tmpdir(), 'mxik-e2e');

/**
 * Wraps a test body: when it fails, the error message gains the page's URL and
 * the path of a full-page screenshot, so a red test says where it stood.
 */
export function traced(getPage: () => Page | undefined, body: (t: TestContext) => Promise<void>): (t: TestContext) => Promise<void> {
  return async (t) => {
    const seen = navigationWarnings.length;
    try {
      await body(t);
      const fired = navigationWarnings.slice(seen);
      assert.deepEqual(fired, [], 'every in-app navigation commits without the watchdog');
    } catch (error) {
      const page = getPage();
      if (page && !page.isClosed() && error instanceof Error) {
        await mkdir(ARTIFACTS, { recursive: true }).catch(() => undefined);
        const file = join(ARTIFACTS, `${Date.now()}-${t.name.replace(/[^\w-]+/g, '-').slice(0, 60)}.png`);
        const saved = await page.screenshot({ path: file, fullPage: true }).then(() => true, () => false);
        const where = `\n    page: ${page.url()}${saved ? `\n    screenshot: ${file}` : ''}`;
        error.message += where;
        // The reporter prints the stack, which was built with the old message.
        if (error.stack) error.stack = error.stack.replace(/\n\s+at /, `${where}\n    at `);
      }
      throw error;
    }
  };
}

// ------------------------------------------------------------------- polling

export async function poll<V>(what: string, read: () => Promise<V>, done: (v: V) => boolean, timeoutMs: number, everyMs = 1000): Promise<V> {
  const until = Date.now() + timeoutMs;
  let last: V = await read();
  while (!done(last)) {
    if (Date.now() > until) throw new Error(`timed out after ${Math.round(timeoutMs / 1000)} s waiting for ${what}; last value ${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, everyMs));
    last = await read();
  }
  return last;
}

export { db };
