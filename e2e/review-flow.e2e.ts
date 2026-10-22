// The accountant's whole path through the product, in order, as one firm:
// sign in, add a client, upload a catalogue through the wizard, correct the
// column mapping, wait for the audit, filter, open a row, decide, check the
// record and the activity log, export, re-upload a changed file and read the
// version diff, then the same catalogue as a scoped accountant and as a viewer,
// a failing upload and a keyboard-only review.
//
// Tests share one firm and run in order; a test whose prerequisite failed is
// reported as skipped, not as a second failure.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import {
  COMMIT, db, digits, E2E_PASSWORDS, findingIdOf, gridRows, launch, newPage, plainNumbers, poll, readXlsx, setupFirm, signIn, statValue,
  T, TA, traced, XLSX_MIME, xlsxFile, type Cell, type Fixture,
} from './fixture';

const AUDIT_TIMEOUT = Number(process.env['E2E_AUDIT_TIMEOUT_MS'] ?? 15 * 60_000);

// The file a firm would get from a client's 1C: a group column before the name,
// which the header heuristics take for the name (the mapping step must be corrected).
const HEADERS = ['Tovar guruhi', 'Nomi', 'MXIK kodi', 'Oʻlchov birligi', 'Narxi'];
const V1: Cell[][] = [
  ['Sabzavotlar', 'Лук репчатый', '', 'кг', 55500],
  ['Mevalar', 'Limon', '', 'kg', 37500],
  ['Un mahsulotlari', 'Un 1-nav 10 kg', '', 'kg', 83500],
  ['Makaron', 'Makaron spagetti 400g', '', 'dona', 94500],
  ['Yogʻlar', "Paxta yog'i 1 l", '', 'litr', 23000],
  ['Sut mahsulotlari', 'Tvorog 9% 250 gr', '00406002001000999', 'dona', 58500],
  ['Kantselyariya', 'Daftar 48 varaq katak', '04820002001000999', 'dona', 32500],
  ['Shakar', 'Shakar 3 кг', '03402003024000000', 'dona', 92000],
  ['Un mahsulotlari', 'Un oliy nav 1 кг', '00803001001000000', 'kg', 37500],
  ['Ichimliklar', 'Шарбат олма 1 л', '02009001006000000', 'metr', 88000],
  ['Sabzavotlar', 'Sabzi', '00706001001000000', 'kg', 44500],
  ['Sabzavotlar', 'Kartoshka', '00701001001000000', 'kg', 93000],
  ['Sabzavotlar', 'Pomidor', '00702001001000000', 'kg', 500],
];
// Version 2: one row's unit changed, the last row removed, two rows added.
const V2: Cell[][] = [
  ...V1.slice(0, 10),
  ['Sabzavotlar', 'Sabzi', '00706001001000000', 'dona', 44500],
  V1[11] as Cell[],
  ['Mevalar', 'Банан', '', 'кг', 86000],
  ['Xoʻjalik mollari', 'Gugurt 10 quti', '03605001001000000', 'dona', 58500],
];
/** Rows the version-2 file changes or drops: no decision is made on them, so the carry-over count is exact. */
const KEEP_UNDECIDED = new Set(['Sabzi', 'Kartoshka', 'Pomidor']);

const TYPE_LABEL: Record<string, string> = {
  MISSING: T.typeMissing, NOT_FOUND: T.typeNotFound, MISMATCH: T.typeMismatch, UNIT_CONFLICT: T.typeUnitConflict,
  NOT_PURCHASED: T.typeNotPurchased, PRIVILEGE_CODE: T.typePrivilegeCode, PRIVILEGE_OPPORTUNITY: T.typePrivilegeOpportunity, RESTRICTED: T.typeRestricted,
};
const SUGGESTING = ['MISSING', 'NOT_FOUND', 'MISMATCH'] as const;

type Decided = { findingId: string; product: string; decision: 'accepted' | 'rejected'; code: string | null; original: string; picked: boolean };

const state: {
  v1Id?: string; v1Name?: string; v2Name?: string;
  /** Set once version 2 is audited. */
  v2Id?: string;
  /** The newest audited catalogue of client A. */
  ready?: string;
  decided: Decided[];
  /** The decide server action as the browser called it, for the viewer's direct attempt. */
  decideAction?: { id: string; url: string };
} = { decided: [] };

function need(t: TestContext, value: unknown, what: string): boolean {
  if (value) return true;
  t.skip(`needs ${what} from an earlier test`);
  return false;
}

const main = (page: Page) => page.locator('main');

/** The page a test is driving, for the failure screenshot. */
let current: Page | undefined;
const test = (name: string, options: { timeout: number }, body: (t: TestContext) => Promise<void>) => it(name, options, traced(() => current, body));

async function mainText(page: Page): Promise<string> {
  return (await main(page).textContent()) ?? '';
}

/** Waits until a button is enabled (the mapping step disables "next" while diagnostics refresh). */
async function enabled(page: Page, name: string, timeoutMs = 30_000): Promise<void> {
  const button = main(page).getByRole('button', { name, exact: true });
  await button.waitFor();
  await poll(`"${name}" enabled`, () => button.isEnabled(), Boolean, timeoutMs, 200);
}

/** Pending findings of a catalogue as the default workspace view lists them (high and medium). */
async function pendingRisky(catalogId: string): Promise<number> {
  return db.finding.count({ where: { item: { catalogId }, decision: 'pending', severity: { in: ['high', 'medium'] } } });
}

async function liveCodes(codes: string[]): Promise<Set<string>> {
  if (codes.length === 0) return new Set();
  const rows = await db.mxikCode.findMany({ where: { code: { in: codes }, retiredAt: null }, select: { code: true } });
  return new Set(rows.map((r) => r.code.trim()));
}

/** Hands a file to the wizard's (visually hidden) file input, as choosing it in the dialog does. */
async function chooseFile(page: Page, name: string, buffer: Buffer, mimeType = XLSX_MIME): Promise<void> {
  await main(page).locator('input[type="file"]').setInputFiles({ name, mimeType, buffer });
}

describe('review flow: one firm from sign-in to export and re-upload', () => {
  let fx: Fixture;
  let browser: Browser;
  let admin: { context: BrowserContext; page: Page };

  before(async () => {
    fx = await setupFirm('flow');
    browser = await launch();
    admin = await newPage(browser);
    admin.page.on('request', (request) => {
      const action = request.headers()['next-action'];
      const body = request.postData() ?? '';
      if (request.method() === 'POST' && action && !state.decideAction && body.includes('"findingId"') && body.includes('"decision":"accepted"')) {
        state.decideAction = { id: action, url: request.url() };
      }
    });
  });

  after(async () => {
    await browser?.close();
    await fx?.cleanup();
  });

  test('1 sign in: a wrong password is refused in words, the right one opens the dashboard', { timeout: 120_000 }, async () => {
    const { page } = admin;
    current = page;
    await page.goto('/sign-in');
    await page.locator('#email').fill(fx.admin.email);
    await page.locator('#password').fill('not-the-password-123');
    await page.getByRole('button', { name: T.signInAction, exact: true }).click();
    const alert = page.locator('form [role="alert"]');
    await alert.waitFor();
    assert.equal((await alert.innerText()).trim(), T.signInError);
    assert.equal(new URL(page.url()).pathname, '/sign-in');

    await signIn(page, fx.admin.email, E2E_PASSWORDS.admin);
    assert.equal(new URL(page.url()).pathname, '/dashboard');
    await main(page).getByRole('heading', { level: 1 }).first().waitFor();
    const signedIn = await db.auditEvent.count({ where: { orgId: fx.orgId, actorId: fx.admin.id, action: 'user.signed_in' } });
    assert.equal(signedIn, 1, 'one successful sign-in is logged');
  });

  test('2 the admin creates a client (two in a row, as a firm onboarding its clients does)', { timeout: 120_000 }, async (t) => {
    const { page } = admin;
    current = page;
    const words = TA.firmX.clients;
    const names = [1, 2].map((n) => `E2E Yangi mijoz ${n} ${fx.tag}`);
    const stuck: string[] = [];
    for (const name of names) {
      await page.goto('/clients');
      await main(page).getByRole('button', { name: words.add, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: words.dialogTitle });
      await dialog.waitFor();
      await dialog.getByLabel(words.nameLabel).fill(name);
      await dialog.getByRole('button', { name: words.create, exact: true }).click();
      // The action saves the client and redirects to its page.
      const opened = await main(page).getByRole('heading', { level: 1, name }).waitFor({ timeout: 15_000 }).then(() => true, () => false);
      const client = await poll(`${name} saved`, () => db.client.findFirst({ where: { orgId: fx.orgId, name }, select: { id: true, archivedAt: true } }), Boolean, 10_000, 250);
      assert.ok(client, `${name} is saved`);
      assert.equal(client.archivedAt, null);
      if (opened) {
        assert.equal(new URL(page.url()).pathname, `/clients/${client.id}`);
      } else {
        // Product bug, reported: the action answered 303 to the new client's page, but the browser
        // stays on /clients behind a dialog whose button spins and which cannot be closed.
        stuck.push(name);
        const busy = await dialog.getByRole('button', { name: words.create }).getAttribute('aria-busy');
        t.diagnostic(`${name}: saved, but after 15 s the page is still ${new URL(page.url()).pathname} with the dialog open (button aria-busy=${busy})`);
      }
    }

    await page.goto('/clients');
    for (const name of names) await main(page).getByRole('link', { name, exact: true }).first().waitFor();
    assert.deepEqual(stuck, [], 'after "Mijozni yaratish" the browser must open the new client\'s page');
  });

  test('3 upload a small catalogue through the wizard', { timeout: 180_000 }, async () => {
    const { page } = admin;
    current = page;
    state.v1Name = `e2e-katalog-${fx.tag}.xlsx`;
    await page.goto(`/upload?client=${fx.clientA.id}`);
    assert.equal(await main(page).getByLabel(TA.importX.select.client, { exact: true }).inputValue(), fx.clientA.id, 'the client from the link is preselected');
    await chooseFile(page, state.v1Name, await xlsxFile(HEADERS, V1));

    await main(page).getByRole('heading', { name: TA.importX.check.title }).waitFor({ timeout: 90_000 });
    const id = new URL(page.url()).searchParams.get('catalog');
    assert.ok(id, 'the wizard keeps the upload in the URL');
    state.v1Id = id;
    const catalog = await db.catalog.findUnique({ where: { id }, select: { status: true, rowCount: true, clientId: true, filename: true, orgId: true } });
    assert.ok(catalog);
    assert.deepEqual(
      { status: catalog.status, rows: catalog.rowCount, client: catalog.clientId, file: catalog.filename, org: catalog.orgId },
      { status: 'uploaded', rows: V1.length, client: fx.clientA.id, file: state.v1Name, org: fx.orgId },
    );
    const text = await mainText(page);
    assert.ok(text.includes(TA.importX.check.formats.xlsx), 'the format is named');
    assert.ok(text.includes('Лук репчатый'), 'the sample rows are shown');
    await main(page).getByRole('button', { name: TA.importX.check.next, exact: true }).click();
  });

  test('4 review and correct the column mapping', { timeout: 120_000 }, async (t) => {
    if (!need(t, state.v1Id, 'an upload')) return;
    const { page } = admin;
    current = page;
    const m = TA.importX.map;
    const fields = TA.importX.fields;
    await main(page).getByRole('heading', { name: m.title }).waitFor();
    // Required fields carry a " *" in their label text, so labels are matched as substrings (all are distinct).
    const select = (label: string) => main(page).getByLabel(label);
    assert.ok((await mainText(page)).includes(m.guessed), 'the mapping is presented as a guess to check');

    // The heuristics read "Tovar guruhi" (product group) as the name column: the reviewer has to fix it.
    assert.equal(await select(fields.name).inputValue(), '0', 'guessed name column is "Tovar guruhi"');
    assert.equal(await select(fields.mxik).inputValue(), '2', 'MXIK kodi');
    assert.equal(await select(fields.unit).inputValue(), '3', 'Oʻlchov birligi');
    assert.equal(await select(fields.price).inputValue(), '4', 'Narxi');
    assert.equal(await select(fields.barcode).inputValue(), '-1', 'no barcode column');

    // The reviewer corrects the name column, then waits for the diagnostics to refresh.
    const settle = async (): Promise<string> => {
      await enabled(page, m.next);
      await page.waitForTimeout(2_000);
      await enabled(page, m.next);
      return select(fields.name).inputValue();
    };
    await select(fields.name).selectOption('1');
    const afterFirstChange = await settle();
    // Product bug, reported: the first mapping change after the file is read is undone about half a
    // second later, when the wizard re-mounts on the URL it rewrote. A reviewer who notices redoes it.
    const reverted = afterFirstChange !== '1';
    if (reverted) {
      t.diagnostic('the name column fell back to the guess after the first change; choosing it again');
      await select(fields.name).selectOption('1');
      assert.equal(await settle(), '1', 'a second correction sticks');
    }

    // Choosing the name column for MXIK as well is flagged as a duplicate and blocks the next step.
    await select(fields.mxik).selectOption('1');
    await main(page).getByText(m.fixFirst).waitFor();
    assert.equal(await main(page).getByRole('button', { name: m.next, exact: true }).isDisabled(), true, 'next is blocked by a duplicate');
    await select(fields.mxik).selectOption('2');
    await enabled(page, m.next);
    assert.deepEqual(
      [await select(fields.name).inputValue(), await select(fields.mxik).inputValue()], ['1', '2'], 'mapping before confirming',
    );
    await main(page).getByRole('button', { name: m.next, exact: true }).click();

    await main(page).getByRole('heading', { name: TA.importX.confirm.title }).waitFor();
    const text = await mainText(page);
    assert.ok(plainNumbers(text).includes(plainNumbers(TA.importX.confirm.rows(V1.length))), 'confirm step says how many rows will be checked');
    assert.ok(text.includes(TA.importX.confirm.noPrevious), 'first catalogue of the client');
    await main(page).getByRole('button', { name: TA.importX.confirm.start, exact: true }).click();
    await main(page).getByRole('heading', { name: TA.importX.processing.title }).or(main(page).getByRole('heading', { name: TA.importX.done.title })).waitFor();

    assert.equal(reverted, false, 'the first column correction must stay: it was silently reset to the guessed column (upload wizard re-mounted after the first diagnostics call)');
  });

  test('5 the import becomes a workspace once the audit finishes', { timeout: AUDIT_TIMEOUT + 120_000 }, async (t) => {
    if (!need(t, state.v1Id, 'an upload')) return;
    const { page } = admin;
    current = page;
    const id = state.v1Id as string;
    const started = Date.now();
    await main(page).getByRole('heading', { name: TA.importX.done.title }).waitFor({ timeout: AUDIT_TIMEOUT });
    t.diagnostic(`audit of ${V1.length} rows took ${((Date.now() - started) / 1000).toFixed(1)} s (from commit to done screen)`);

    const catalog = await db.catalog.findUnique({ where: { id }, select: { status: true, columnMap: true, auditError: true } });
    assert.equal(catalog?.status, 'ready');
    assert.equal(catalog?.auditError, null);
    state.ready = id;
    assert.equal((catalog?.columnMap as { name?: number } | null)?.name, 1, 'the corrected name column was committed');
    const names = await db.catalogItem.findMany({ where: { catalogId: id }, orderBy: { rowIndex: 'asc' }, select: { rawName: true } });
    assert.deepEqual(names.map((n) => n.rawName), V1.map((r) => r[1]), 'items carry the product names, not the group');
    assert.equal(digits(await statValue(page, TA.importX.done.rows)), V1.length, 'done screen counts every row');

    await Promise.all([
      page.waitForURL((url) => url.pathname === `/catalogs/${id}`, COMMIT),
      main(page).getByRole('link', { name: TA.importX.done.openWorkspace, exact: true }).click(),
    ]);
    await gridRows(page).first().waitFor();
    assert.equal(await gridRows(page).count(), await pendingRisky(id), 'the grid lists every pending high or medium finding');
  });

  test('6 type filters change the visible rows', { timeout: 120_000 }, async (t) => {
    if (!need(t, state.v1Id, 'an audited catalogue')) return;
    const { page } = admin;
    current = page;
    const id = state.v1Id as string;
    await page.goto(`/catalogs/${id}`);
    await gridRows(page).first().waitFor();
    const all = await gridRows(page).count();

    const groups = await db.finding.groupBy({ by: ['type'], where: { item: { catalogId: id }, decision: 'pending' }, _count: { _all: true } });
    const types = groups.filter((g) => g._count._all > 0).sort((a, b) => a._count._all - b._count._all).map((g) => g.type);
    t.diagnostic(`finding types: ${groups.map((g) => `${g.type}=${g._count._all}`).join(', ')}`);
    assert.ok(types.length >= 2, 'the audit found at least two kinds of problem in this file');

    const chips = page.getByRole('navigation', { name: TA.wsX.kpi.chipsLabel });
    const counts: number[] = [];
    for (const type of types.slice(0, 2)) {
      const label = TYPE_LABEL[type] ?? type;
      await Promise.all([
        page.waitForURL((url) => url.searchParams.get('type') === type, COMMIT),
        chips.getByRole('link', { name: new RegExp(`^${label}:`) }).click(),
      ]);
      const expected = await db.finding.count({ where: { item: { catalogId: id }, type, decision: 'pending' } });
      // Each row's status chip carries its check's name as a title.
      const statuses = (): Promise<boolean[]> => gridRows(page).evaluateAll(
        (els, wanted) => els.map((el) => Array.from(el.querySelectorAll('[title]')).some((c) => c.getAttribute('title') === wanted)), label,
      );
      const shown = await poll(`${type} rows`, statuses, (s) => s.length === expected && s.every(Boolean), 15_000, 200);
      assert.equal(shown.length, expected, `the ${type} filter shows exactly its pending findings`);
      assert.equal(await chips.getByRole('link', { name: new RegExp(`^${label}:`) }).getAttribute('aria-current'), 'true');
      counts.push(expected);
    }
    assert.ok(counts.some((n) => n !== all), 'a type filter changes how many rows are visible');

    await Promise.all([
      page.waitForURL((url) => !url.searchParams.has('type'), COMMIT),
      chips.getByRole('link', { name: new RegExp(`^${TA.wsX.kpi.all}:`) }).click(),
    ]);
    await poll('all rows back', () => gridRows(page).count(), (n) => n === all, 15_000, 200);
  });

  test('7 a row drawer explains the finding', { timeout: 120_000 }, async (t) => {
    if (!need(t, state.v1Id, 'an audited catalogue')) return;
    const { page } = admin;
    current = page;
    const id = state.v1Id as string;
    const finding = await db.finding.findFirst({
      where: { item: { catalogId: id }, decision: 'pending', severity: { in: ['high', 'medium'] } },
      orderBy: { item: { rowIndex: 'asc' } },
      select: { id: true, type: true, reason: true, item: { select: { rowIndex: true, rawName: true } } },
    });
    assert.ok(finding, 'a pending finding to open');
    await page.goto(`/catalogs/${id}`);
    const row = page.locator(`#ws-row-${finding.id}`);
    await row.waitFor();
    await row.getByText(finding.item.rawName, { exact: true }).click();

    const drawer = page.getByRole('complementary', { name: TA.wsX.drawer.title(String(finding.item.rowIndex + 1)) });
    await drawer.waitFor();
    await drawer.getByRole('heading', { name: TA.wsX.reasonTitle }).waitFor();
    const text = (await drawer.textContent()) ?? '';
    assert.ok(text.includes(finding.item.rawName), 'drawer names the product');
    assert.ok(text.includes(TA.wsX.explain[finding.type] ?? '§'), 'drawer explains the check in words');
    assert.ok(text.includes(finding.reason), 'drawer shows the audit reason');
    await drawer.getByRole('button', { name: TA.shell.close }).click();
    await drawer.waitFor({ state: 'detached' });
  });

  test('8 accept a suggestion, reject one, and pick another code for a third', { timeout: 180_000 }, async (t) => {
    if (!need(t, state.v1Id, 'an audited catalogue')) return;
    const { page } = admin;
    current = page;
    const id = state.v1Id as string;
    const findings = await db.finding.findMany({
      where: { item: { catalogId: id }, decision: 'pending', severity: { in: ['high', 'medium'] } },
      orderBy: { item: { rowIndex: 'asc' } },
      select: {
        id: true, type: true, suggestedMxik: true, alternatives: true, evidence: true,
        item: { select: { id: true, rawName: true, existingMxik: true, _count: { select: { findings: true } } } },
      },
    });
    // One finding per row, on rows version 2 keeps unchanged.
    const usable = findings.filter((f) => f.item._count.findings === 1 && !KEEP_UNDECIDED.has(f.item.rawName));
    const suggesting = usable.filter((f) => (SUGGESTING as readonly string[]).includes(f.type) && f.suggestedMxik
      && (f.evidence as { rerankNone?: boolean } | null)?.rerankNone !== true);
    const live = await liveCodes(usable.flatMap((f) => [
      ...(f.suggestedMxik ? [f.suggestedMxik] : []),
      ...((Array.isArray(f.alternatives) ? f.alternatives : []) as { code?: string }[]).flatMap((a) => (a.code ? [a.code] : [])),
    ]));
    const altOf = (f: (typeof usable)[number]): string | null => {
      const list = (Array.isArray(f.alternatives) ? f.alternatives : []) as { code?: string }[];
      return list.map((a) => a.code ?? '').find((c) => c && c !== f.suggestedMxik && live.has(c)) ?? null;
    };
    const toAccept = suggesting.find((f) => live.has(f.suggestedMxik ?? ''));
    const toPick = suggesting.find((f) => f !== toAccept && altOf(f));
    const toReject = usable.find((f) => f !== toAccept && f !== toPick);
    assert.ok(toAccept && toPick && toReject, `three different rows to decide (usable ${usable.length}, suggesting ${suggesting.length})`);

    await page.goto(`/catalogs/${id}`);
    await gridRows(page).first().waitFor();

    // Accept the suggestion from the row.
    const acceptRow = page.locator(`#ws-row-${toAccept.id}`);
    await acceptRow.getByRole('button', { name: TA.wsX.act.accept, exact: true }).click();
    await acceptRow.getByRole('button', { name: TA.wsX.act.undo, exact: true }).waitFor();
    await poll('accepted in the database', () => db.finding.findUnique({ where: { id: toAccept.id }, select: { decision: true } }), (f) => f?.decision === 'accepted', 15_000, 250);
    state.decided.push({ findingId: toAccept.id, product: toAccept.item.rawName, decision: 'accepted', code: toAccept.suggestedMxik, original: toAccept.item.existingMxik ?? '', picked: false });

    // Reject another.
    const rejectRow = page.locator(`#ws-row-${toReject.id}`);
    await rejectRow.getByRole('button', { name: TA.wsX.act.reject, exact: true }).click();
    await rejectRow.getByRole('button', { name: TA.wsX.act.undo, exact: true }).waitFor();
    await poll('rejected in the database', () => db.finding.findUnique({ where: { id: toReject.id }, select: { decision: true } }), (f) => f?.decision === 'rejected', 15_000, 250);
    state.decided.push({ findingId: toReject.id, product: toReject.item.rawName, decision: 'rejected', code: null, original: toReject.item.existingMxik ?? '', picked: false });

    // Pick a different code from the drawer's alternatives.
    const alt = altOf(toPick) as string;
    const pickRow = page.locator(`#ws-row-${toPick.id}`);
    await pickRow.getByText(toPick.item.rawName, { exact: true }).click();
    const drawer = page.getByRole('complementary');
    await drawer.getByRole('heading', { name: TA.wsX.drawer.alternatives }).waitFor();
    await drawer.getByRole('button', { name: `${TA.wsX.drawer.choose}: ${alt}`, exact: true }).click();
    await poll('picked code in the database', () => db.finding.findUnique({ where: { id: toPick.id }, select: { decision: true, chosenMxik: true } }), (f) => f?.decision === 'accepted' && f.chosenMxik === alt, 15_000, 250);
    await pickRow.getByRole('button', { name: TA.wsX.act.undo, exact: true }).waitFor();
    state.decided.push({ findingId: toPick.id, product: toPick.item.rawName, decision: 'accepted', code: alt, original: toPick.item.existingMxik ?? '', picked: true });
    assert.ok(state.decideAction, 'the browser called the decide action (kept for the viewer test)');
  });

  test('9 each decision is stored with who, how and an audit event', { timeout: 60_000 }, async (t) => {
    if (!need(t, state.decided.length === 3, 'three decisions')) return;
    for (const d of state.decided) {
      const f = await db.finding.findUnique({ where: { id: d.findingId }, select: { decision: true, chosenMxik: true, decidedBy: true, decidedAt: true, decisionSource: true, decisionEventId: true, suggestedMxik: true } });
      assert.ok(f);
      assert.equal(f.decision, d.decision, d.product);
      assert.equal(f.chosenMxik, d.code, `${d.product}: chosen code`);
      assert.equal(f.decidedBy, fx.admin.id, `${d.product}: decidedBy is the admin`);
      assert.equal(f.decisionSource, 'manual', `${d.product}: decisionSource`);
      assert.ok(f.decidedAt, `${d.product}: decidedAt`);
      assert.ok(f.decisionEventId, `${d.product}: linked audit event`);
      const event = await db.auditEvent.findUnique({ where: { id: f.decisionEventId } });
      assert.ok(event, `${d.product}: audit_event row exists`);
      assert.equal(event.orgId, fx.orgId);
      assert.equal(event.actorId, fx.admin.id);
      assert.equal(event.action, `finding.${d.decision}`);
      assert.equal(event.targetId, d.findingId);
      const payload = event.payload as Record<string, unknown>;
      assert.equal(payload['catalogId'], state.v1Id);
      assert.equal(payload['source'], 'manual');
      assert.equal(payload['chosenMxik'], d.code);
      assert.equal(payload['productName'], d.product);
      if (d.picked) assert.equal(payload['overrodeSuggestion'], true, 'a picked code is recorded as overriding the suggestion');
    }

    // The drawer of a decided row names who decided it.
    const { page } = admin;
    current = page;
    const accepted = state.decided[0] as Decided;
    await page.goto(`/catalogs/${state.v1Id}?dec=all`);
    const row = page.locator(`#ws-row-${accepted.findingId}`);
    await row.getByText(accepted.product, { exact: true }).click();
    const drawer = page.getByRole('complementary');
    await drawer.getByText(fx.admin.email, { exact: false }).first().waitFor();
  });

  test('10 the activity log shows the decisions', { timeout: 60_000 }, async (t) => {
    if (!need(t, state.decided.length === 3, 'three decisions')) return;
    const { page } = admin;
    current = page;
    await page.goto('/activity');
    // The user filter lists e-mails as <option>s; wait for the log table itself.
    const table = main(page).getByRole('table');
    await table.getByRole('link', { name: state.v1Name ?? '§' }).first().waitFor();
    const text = (await table.textContent()) ?? '';
    assert.ok(text.includes(fx.admin.email), 'the actor is named');
    assert.ok(text.includes(state.v1Name ?? '§'), 'the catalogue is named');
    for (const d of state.decided) assert.ok(text.includes(d.product), `the log mentions ${d.product}`);
    assert.ok(text.includes(TA.activity.actions['finding.accepted'] ?? '§'), 'accept is in the log');
    assert.ok(text.includes(TA.activity.actions['finding.rejected'] ?? '§'), 'reject is in the log');
  });

  test('11 export downloads an xlsx with the accepted codes in the MXIK column', { timeout: 120_000 }, async (t) => {
    if (!need(t, state.decided.length === 3, 'three decisions')) return;
    const { page } = admin;
    current = page;
    const x = TA.importX.exp;
    await page.goto(`/catalogs/${state.v1Id}`);
    await page.getByRole('button', { name: x.menu, exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByRole('menuitem', { name: x.items.xlsx, exact: true }).click(),
    ]);
    assert.match(download.suggestedFilename(), /\.xlsx$/);
    const file = await download.path();
    assert.ok(file, 'the download was saved');
    const rows = await readXlsx(await readFile(file));
    const header = rows[0] ?? [];
    const nameCol = header.indexOf('Nomi');
    const mxikCol = header.indexOf('MXIK kodi');
    assert.ok(nameCol >= 0 && mxikCol >= 0, `export keeps the original columns (${header.join(' | ')})`);
    assert.equal(rows.length - 1, V1.length, 'every row is exported');
    for (const d of state.decided) {
      const line = rows.find((r) => r[nameCol] === d.product);
      assert.ok(line, `${d.product} is in the export`);
      const expected = d.decision === 'accepted' ? d.code : d.original;
      assert.equal(line[mxikCol] ?? '', expected ?? '', `${d.product}: MXIK column`);
    }
    const logged = await db.auditEvent.count({ where: { orgId: fx.orgId, actorId: fx.admin.id, action: 'catalog.exported', targetId: state.v1Id } });
    assert.equal(logged, 1, 'the export is logged');
  });

  test('12 re-upload a changed file: decisions carry over and the version diff counts the changes', { timeout: AUDIT_TIMEOUT + 180_000 }, async (t) => {
    if (!need(t, state.decided.length === 3, 'three decisions')) return;
    const { page } = admin;
    current = page;
    const m = TA.importX.map;
    state.v2Name = `e2e-katalog-${fx.tag}-v2.xlsx`;
    await page.goto(`/upload?client=${fx.clientA.id}`);
    await chooseFile(page, state.v2Name, await xlsxFile(HEADERS, V2));
    await main(page).getByRole('heading', { name: TA.importX.check.title }).waitFor({ timeout: 90_000 });
    const v2Id = new URL(page.url()).searchParams.get('catalog') ?? '';
    await main(page).getByRole('button', { name: TA.importX.check.next, exact: true }).click();

    await main(page).getByRole('heading', { name: m.title }).waitFor();
    assert.ok((await mainText(page)).includes(m.remembered.client), 'the mapping is remembered from the client\'s last file');
    assert.equal(await main(page).getByLabel(TA.importX.fields.name).inputValue(), '1', 'the corrected name column is remembered');
    await enabled(page, m.next);
    await main(page).getByRole('button', { name: m.next, exact: true }).click();
    await main(page).getByRole('heading', { name: TA.importX.confirm.title }).waitFor();
    assert.ok((await mainText(page)).includes(state.v1Name ?? '§'), 'confirm step names the previous version');
    await main(page).getByRole('button', { name: TA.importX.confirm.start, exact: true }).click();

    const started = Date.now();
    await main(page).getByRole('heading', { name: TA.importX.done.title }).waitFor({ timeout: AUDIT_TIMEOUT });
    t.diagnostic(`audit of version 2 (${V2.length} rows) took ${((Date.now() - started) / 1000).toFixed(1)} s`);
    const v2 = await db.catalog.findUnique({ where: { id: v2Id }, select: { previousId: true, status: true } });
    assert.equal(v2?.status, 'ready');
    assert.equal(v2?.previousId, state.v1Id, 'version 2 points at version 1');
    state.v2Id = v2Id;
    state.ready = v2Id;
    assert.equal(digits(await statValue(page, TA.importX.done.carried)), state.decided.length, 'done screen: carried decisions');

    await Promise.all([
      page.waitForURL((url) => url.pathname === `/catalogs/${state.v2Id}/diff`, COMMIT),
      main(page).getByRole('link', { name: TA.importX.done.openDiff, exact: true }).click(),
    ]);
    await main(page).getByRole('heading', { name: TA.diff.title }).waitFor();
    const counts = {
      added: digits(await statValue(page, TA.diff.added)),
      removed: digits(await statValue(page, TA.diff.removed)),
      changed: digits(await statValue(page, TA.diff.changed)),
      unchanged: digits(await statValue(page, TA.importX.diff.unchanged)),
      carried: digits(await statValue(page, TA.importX.diff.carried)),
    };
    t.diagnostic(`diff: ${JSON.stringify(counts)}`);
    assert.deepEqual(counts, { added: 2, removed: 1, changed: 1, unchanged: 11, carried: state.decided.length });
    const text = await mainText(page);
    for (const name of ['Банан', 'Gugurt 10 quti', 'Pomidor', 'Sabzi']) assert.ok(text.includes(name), `diff lists ${name}`);

    const carried = await db.finding.findMany({ where: { item: { catalogId: state.v2Id }, decisionSource: 'carry_over' }, select: { decidedBy: true, item: { select: { rawName: true } } } });
    assert.deepEqual(carried.map((c) => c.item.rawName).sort(), state.decided.map((d) => d.product).sort(), 'the same rows carried their decision');
    assert.ok(carried.every((c) => c.decidedBy === fx.admin.id), 'carried decisions keep the original decider');
  });

  test('13 an accountant scoped to client A cannot open client B or another firm, nor can the other firm open ours', { timeout: 120_000 }, async (t) => {
    if (!need(t, state.ready, 'an audited catalogue of client A')) return;
    const { context, page } = await newPage(browser);
    current = page;
    await signIn(page, fx.accountant.email, E2E_PASSWORDS.accountant);
    const own = await page.goto(`/catalogs/${state.ready}`);
    assert.equal(own?.status(), 200);
    await gridRows(page).first().waitFor();

    for (const [what, id, filename] of [
      ['client B', fx.clientBCatalogId, `mijoz-b-${fx.tag}.xlsx`],
      ['another firm', fx.otherCatalogId, `boshqa-firma-${fx.tag}.xlsx`],
    ] as const) {
      await page.goto(`/catalogs/${id}`);
      await main(page).getByRole('heading', { name: TA.shellX.notFound.title }).waitFor();
      const text = await mainText(page);
      assert.ok(!text.includes(filename), `${what}: the catalogue name does not leak`);
      assert.equal(await gridRows(page).count(), 0, `${what}: no rows`);
      const api = await page.request.get(`/api/export?catalog=${id}`);
      assert.equal(api.status(), 404, `${what}: export API answers 404`);
    }
    const ownExport = await page.request.get(`/api/export?catalog=${state.v1Id}`);
    assert.equal(ownExport.status(), 200, 'the accountant may export client A');

    await page.goto('/clients');
    await main(page).getByRole('link', { name: fx.clientA.name, exact: true }).first().waitFor();
    assert.ok(!(await mainText(page)).includes(fx.clientB.name), 'client B is not listed');
    await page.goto(`/clients/${fx.clientB.id}`);
    await main(page).getByRole('heading', { name: TA.shellX.notFound.title }).waitFor();
    await context.close();

    // The other firm's admin sees all of their own firm, and nothing of this one.
    const other = await newPage(browser);
    current = other.page;
    await signIn(other.page, fx.otherAdmin.email, E2E_PASSWORDS.otherAdmin);
    await other.page.goto(`/catalogs/${state.ready}`);
    await main(other.page).getByRole('heading', { name: TA.shellX.notFound.title }).waitFor();
    assert.equal((await other.page.request.get(`/api/export?catalog=${state.ready}`)).status(), 404, 'another firm\'s admin cannot export it');
    assert.equal((await other.page.request.get(`/api/export?catalog=${fx.otherCatalogId}`)).status(), 200, 'but can export their own');
    await other.context.close();
  });

  // The (app) segment streams behind loading.tsx, so Next answers 200 and renders the not-found page
  // in the stream (with noindex). What matters is that nothing out of scope is shown.
  test('13b out-of-scope catalogue pages show the not-found page and leak nothing', { timeout: 120_000 }, async () => {
    const { context, page } = await newPage(browser);
    current = page;
    await signIn(page, fx.accountant.email, E2E_PASSWORDS.accountant);
    const shown: Record<string, boolean> = {};
    for (const [what, path] of [
      ['client B catalogue', `/catalogs/${fx.clientBCatalogId}`],
      ['other firm catalogue', `/catalogs/${fx.otherCatalogId}`],
      ['client B page', `/clients/${fx.clientB.id}`],
      ['missing catalogue', '/catalogs/does-not-exist'],
    ] as const) {
      await page.goto(path);
      await main(page).getByRole('heading', { name: TA.shellX.notFound.title }).waitFor({ timeout: 15_000 });
      const html = await page.content();
      shown[what] = html.includes(fx.clientB.name) || html.includes('Mijoz B tovari') || html.includes(`mijoz-b-${fx.tag}`);
    }
    assert.deepEqual(shown, {
      'client B catalogue': false, 'other firm catalogue': false, 'client B page': false, 'missing catalogue': false,
    }, 'out-of-scope names never reach the page');
    await context.close();
  });

  test('14 a viewer sees no decision buttons and cannot decide, upload or open admin settings', { timeout: 120_000 }, async (t) => {
    if (!need(t, state.ready, 'an audited catalogue')) return;
    const { context, page } = await newPage(browser);
    current = page;
    await signIn(page, fx.viewer.email, E2E_PASSWORDS.viewer);
    const id = state.ready;
    await page.goto(`/catalogs/${id}`);
    await gridRows(page).first().waitFor();
    const a = TA.wsX.act;
    for (const name of [a.accept, a.reject, a.pick, a.confirm, a.undo]) {
      assert.equal(await main(page).getByRole('button', { name, exact: true }).count(), 0, `no "${name}" button for a viewer`);
    }
    assert.ok(await gridRows(page).first().getByText(a.pending, { exact: true }).count() > 0, 'rows say "pending" instead');
    assert.equal(await page.locator('[role="grid"] input[type="checkbox"]').count(), 0, 'no bulk selection');

    // The drawer is read-only too.
    const first = gridRows(page).first();
    const findingId = findingIdOf(await first.getAttribute('id'));
    assert.ok(findingId);
    await first.locator('[role="gridcell"]').nth(2).click();
    const drawer = page.getByRole('complementary');
    await drawer.getByText(a.readOnly).waitFor();
    // The row's details have loaded (the footer above shows before them).
    await drawer.getByRole('heading', { name: TA.wsX.reasonTitle }).waitFor();
    assert.equal(await drawer.getByRole('textbox', { name: TA.drawer.search }).count(), 0, 'no code search');
    for (const button of await drawer.getByRole('button', { name: new RegExp(`^${TA.wsX.drawer.choose}:`) }).all()) {
      assert.equal(await button.isDisabled(), true, 'alternatives cannot be chosen');
    }

    // Calling the decide server action directly, as a crafted request would, is refused.
    if (state.decideAction) {
      const before = await db.finding.findUnique({ where: { id: findingId }, select: { decision: true, decidedBy: true } });
      const reply = await page.evaluate(async ({ action, finding }) => {
        const res = await fetch(window.location.pathname, {
          method: 'POST',
          headers: { 'Next-Action': action, 'Content-Type': 'text/plain;charset=UTF-8', Accept: 'text/x-component' },
          body: JSON.stringify([{ findingId: finding, decision: 'accepted', chosenMxik: null }]),
        });
        return { status: res.status, body: await res.text() };
      }, { action: state.decideAction.id, finding: findingId });
      t.diagnostic(`viewer decide attempt: HTTP ${reply.status}`);
      assert.match(reply.body, /"code":"forbidden"/, 'the action answers forbidden');
      const afterwards = await db.finding.findUnique({ where: { id: findingId }, select: { decision: true, decidedBy: true } });
      assert.deepEqual(afterwards, before, 'nothing changed in the database');
      assert.equal(await db.auditEvent.count({ where: { orgId: fx.orgId, actorId: fx.viewer.id, action: { startsWith: 'finding.' } } }), 0, 'no decision event by the viewer');
    } else {
      assert.fail('the decide action id was not captured in test 8');
    }

    await page.goto('/upload');
    await main(page).getByText(TA.importX.select.readOnlyTitle).waitFor();
    assert.equal(await main(page).locator('input[type="file"]').count(), 0, 'no file input');

    for (const tab of ['integrations', 'data'] as const) {
      await page.goto(`/settings?tab=${tab}`);
      await main(page).getByText(TA.setX.adminOnly(TA.setX.tabs[tab])).waitFor();
    }
    // The team page replaced the team tab: it refuses a viewer on the server and is not in their sidebar.
    await page.goto('/team');
    await main(page).getByText(TA.setX.adminOnly(TA.nav.team)).waitFor();
    assert.equal(await page.getByRole('link', { name: TA.nav.team, exact: true }).count(), 0, 'no team link in the viewer navigation');
    const accountExport = await page.request.get('/api/account/export');
    assert.equal(accountExport.status(), 403, 'account data export is admin-only');

    await page.goto('/clients');
    // Wait for the streamed page (the loading skeleton has no buttons either).
    await main(page).getByText(TA.firmX.clients.viewerNote).waitFor();
    assert.equal(await main(page).getByRole('button', { name: TA.firmX.clients.add, exact: true }).count(), 0, 'no "add client" for a viewer');
    const catalogExport = await page.request.get(`/api/export?catalog=${id}`);
    t.diagnostic(`viewer download of the corrected catalogue file: HTTP ${catalogExport.status()} (read access by design)`);
    await context.close();
  });

  test('15 a failing upload says what is wrong and creates nothing', { timeout: 120_000 }, async () => {
    const { page } = admin;
    current = page;
    const e = TA.importX.errors;
    const before = await db.catalog.count({ where: { orgId: fx.orgId } });
    await page.goto(`/upload?client=${fx.clientA.id}`);

    // A PDF renamed to .xlsx.
    await chooseFile(page, 'hisobot.xlsx', Buffer.from('%PDF-1.4\n\u0000\u0001\u0002\u0003 not a spreadsheet', 'binary'));
    const alert = main(page).locator('[role="alert"]');
    await alert.filter({ hasText: e.binary }).waitFor({ timeout: 60_000 });
    assert.equal((await alert.innerText()).trim(), e.binary);

    // A CSV with a header and no rows.
    await chooseFile(page, 'bosh.csv', Buffer.from('Nomi;MXIK kodi\n', 'utf8'), 'text/csv');
    await alert.filter({ hasText: e.empty }).waitFor({ timeout: 60_000 });

    assert.equal(await main(page).getByRole('heading', { name: TA.importX.check.title }).count(), 0, 'the wizard stays on the file step');
    assert.equal(await db.catalog.count({ where: { orgId: fx.orgId } }), before, 'no catalogue was created');
  });

  test('18 keyboard-only review: j/k move, Enter accepts, u undoes', { timeout: 120_000 }, async (t) => {
    const id = state.ready;
    if (!need(t, id, 'an audited catalogue')) return;
    const { page } = admin;
    current = page;
    await page.goto(`/catalogs/${id}`);
    await gridRows(page).first().waitFor();
    const grid = page.locator('[role="grid"]');
    const active = async (): Promise<string | null> => grid.getAttribute('aria-activedescendant');
    const ids = await gridRows(page).evaluateAll((els) => els.map((el) => el.id));
    assert.ok(ids.length >= 2, 'at least two rows to move between');
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'nothing is focused yet: no mouse involved');

    assert.equal(await active(), ids[0]);
    await page.keyboard.press('j');
    await poll('j moves down', active, (v) => v === ids[1], 5_000, 50);
    await page.keyboard.press('k');
    await poll('k moves up', active, (v) => v === ids[0], 5_000, 50);

    // o opens the drawer for the active row; Escape closes it.
    await page.keyboard.press('o');
    const drawer = page.getByRole('complementary');
    await drawer.waitFor();
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'detached' });

    // Walk down to a row whose suggestion Enter would accept.
    let target: string | null = null;
    for (let i = 0; i < ids.length; i++) {
      const current = await active();
      const row = page.locator(`[id="${current}"]`);
      if (await row.getByRole('button', { name: TA.wsX.act.accept, exact: true }).count() > 0) { target = current; break; }
      await page.keyboard.press('j');
      await poll('j moves', active, (v) => v !== current, 5_000, 50);
    }
    const findingId = findingIdOf(target);
    assert.ok(findingId, 'a row with a suggestion to accept');

    await page.keyboard.press('Enter');
    const accepted = await poll('Enter accepts', () => db.finding.findUnique({ where: { id: findingId }, select: { decision: true, decidedBy: true, decisionSource: true } }), (f) => f?.decision === 'accepted', 15_000, 250);
    assert.equal(accepted?.decidedBy, fx.admin.id);
    assert.equal(accepted?.decisionSource, 'manual');
    assert.notEqual(await active(), target, 'Enter moves on to the next pending row');

    await page.keyboard.press('u');
    await poll('u undoes', () => db.finding.findUnique({ where: { id: findingId }, select: { decision: true } }), (f) => f?.decision === 'pending', 15_000, 250);
    const undone = await db.auditEvent.count({ where: { orgId: fx.orgId, actorId: fx.admin.id, action: 'finding.undone' } });
    assert.equal(undone, 1, 'the undo is logged');
    await page.locator(`#ws-row-${findingId}`).getByRole('button', { name: TA.wsX.act.accept, exact: true }).waitFor();
  });
});
