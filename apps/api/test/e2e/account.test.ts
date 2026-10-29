// endpoints.account against the development database: settings, branding upload, retention,
// closing and reopening, the export, preference cookies, Telegram chats, API keys and the log.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import JSZip from 'jszip';
import { db } from '@tasnivo/db';
import { firmPrice } from '@tasnivo/domain/billing/plans';
import { deleteAfterDays } from '@tasnivo/domain/security/account';
import { i18nFor } from '@tasnivo/i18n/locale';
import { SESSION_COOKIE } from '../../src/auth-core/session.service';
import { bodyOf, dbSkipReason, setCookies, startApp } from '../helpers';
import { client, Fixtures, quietEnv, sessionCookie, TELEGRAM_ON, withEnv } from '../session-helpers';

const skip = await dbSkipReason();
const { t, ta } = i18nFor('uz');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

/** A supertest response body as raw bytes (for the zip). */
function binary(res: { on(event: string, cb: (chunk?: Buffer) => void): void; setEncoding(enc: string): void }, done: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (c) => chunks.push(c as Buffer));
  res.on('end', () => done(null, Buffer.concat(chunks)));
}

describe('account (database)', { skip }, () => {
  let app: INestApplication;
  let call: ReturnType<typeof client>;
  const fx = new Fixtures();
  const restoreEnv = quietEnv();

  before(async () => {
    app = await startApp();
    call = client(app);
  });
  after(async () => {
    await app.close();
    await fx.drop();
    restoreEnv();
    await db.$disconnect();
  });

  it('GET /api/account answers the admin; another role is 403 forbidden in the request\'s language', async () => {
    const u = await fx.user();
    const res = await call(await sessionCookie(u)).get('/api/account');
    assert.equal(res.status, 200);
    const org = await db.organization.findUniqueOrThrow({ where: { id: u.orgId } });
    assert.deepEqual(bodyOf(res), {
      name: org.name, brandName: null, logoUrl: null, dictAutoAccept: org.dictAutoAccept,
      rawRetentionDays: org.rawRetentionDays, rawRetentionSince: org.rawRetentionSince?.toISOString() ?? null, retentionChoices: [7, 30, 90], closeAfterDays: deleteAfterDays(),
      minutesPerDecision: org.minutesPerDecision,
    });
    const viewer = await fx.member(u, 'viewer');
    const refused = await call(await sessionCookie(viewer)).get('/api/account');
    assert.equal(refused.status, 403);
    assert.deepEqual(bodyOf(refused), { error: { code: 'forbidden', message: ta.firmX.errors.forbidden } });
    const ru = await call(`${await sessionCookie(viewer)}; mxik_locale=ru`).get('/api/account');
    assert.equal(bodyOf(ru).error.message, i18nFor('ru').ta.firmX.errors.forbidden);
  });

  it('GET /api/config is public', async () => {
    type Config = { uploadMaxBytes: number; trialDays: number; retentionChoices: number[]; firmPrice: number | null; closeAfterDays: number };
    const res = await withEnv({ PLAN_FIRM_PRICE: undefined, ACCOUNT_DELETE_AFTER_DAYS: '45' }, async () => call().get('/api/config'));
    assert.equal(res.status, 200);
    const body = bodyOf<Config>(res);
    assert.equal(body.uploadMaxBytes, 20 * 1024 * 1024);
    assert.equal(body.trialDays, 14);
    assert.deepEqual(body.retentionChoices, [7, 30, 90]);
    // Prices are in billing/plans.ts now: PLAN_FIRM_PRICE is no longer read, firmPrice is the top tier's monthly price.
    assert.equal(body.firmPrice, firmPrice());
    assert.equal(body.closeAfterDays, 45);
    const env = await withEnv({ PLAN_FIRM_PRICE: '450 000' }, async () => call().get('/api/config'));
    assert.equal(bodyOf<Config>(env).firmPrice, firmPrice());
    const { tiers, plans } = bodyOf<{ tiers: { tier: string; monthly: { id: string } }[]; plans: Record<string, unknown> }>(res);
    assert.deepEqual(tiers.map((t) => t.monthly.id), ['company_monthly', 'accountant_monthly', 'firm_monthly']);
    assert.deepEqual(Object.keys(plans).sort(), ['accountant', 'company', 'firm', 'trial']);
  });

  it('branding: name and PNG/JPEG logo by content, a refused file, removal; admin of a real org only', async () => {
    // Branded PDFs are a feature of the Buxgalter and Byuro plans; the free plan is told so.
    const trial = await fx.user();
    const { prX } = ta;
    assert.deepEqual(bodyOf(await call(await sessionCookie(trial)).post('/api/account/branding').field('brandName', 'Hisob Pro')), { error: prX.notInPlan(prX.features.branding) });
    const u = await fx.user({ plan: 'firm' });
    const cookie = await sessionCookie(u);
    const post = () => call(cookie).post('/api/account/branding');
    assert.deepEqual(bodyOf(await post().field('brandName', '  Hisob   Pro ').attach('logo', PNG, 'logo.png')), { saved: true });
    let org = await db.organization.findUniqueOrThrow({ where: { id: u.orgId } });
    assert.equal(org.brandName, 'Hisob Pro');
    assert.equal(org.logoMime, 'image/png');
    assert.match(bodyOf<{ logoUrl: string }>(await call(cookie).get('/api/account')).logoUrl, /^data:image\/png;base64,/);

    // The browser's claim does not count: a JPEG named .png is stored as JPEG; text is refused.
    assert.deepEqual(bodyOf(await post().attach('logo', JPEG, 'logo.png')), { saved: true });
    assert.equal((await db.organization.findUniqueOrThrow({ where: { id: u.orgId } })).logoMime, 'image/jpeg');
    assert.deepEqual(bodyOf(await post().attach('logo', Buffer.from('not an image'), 'logo.png')), { error: t.brandBadLogo });
    const big = Buffer.concat([PNG, Buffer.alloc(300 * 1024)]);
    assert.deepEqual(bodyOf(await post().attach('logo', big, 'logo.png')), { error: t.brandBadLogo });
    // Over the contract's 120 characters: a malformed request, not a form error.
    assert.equal((await post().field('brandName', 'x'.repeat(121))).status, 400);

    assert.deepEqual(bodyOf(await post().field('brandName', '').field('removeLogo', 'on')), { saved: true });
    org = await db.organization.findUniqueOrThrow({ where: { id: u.orgId } });
    assert.deepEqual([org.brandName, org.logoData, org.logoMime], [null, null, null]);

    const accountant = await fx.member(u, 'accountant');
    assert.equal((await call(await sessionCookie(accountant)).post('/api/account/branding').field('brandName', 'x')).status, 403);
    const demo = await fx.user({ kind: 'demo', expiresAt: new Date(Date.now() + 3_600_000) });
    const refused = await call(await sessionCookie(demo)).post('/api/account/branding').field('brandName', 'x');
    assert.equal(refused.status, 403);
    assert.equal(bodyOf(refused).error.code, 'demo');
  });

  it('retention: a listed choice or null; anything else is false', async () => {
    const u = await fx.user();
    const cookie = await sessionCookie(u);
    assert.equal(bodyOf(await call(cookie).put('/api/account/retention').send({ days: 30 })), true);
    assert.equal((await db.organization.findUniqueOrThrow({ where: { id: u.orgId } })).rawRetentionDays, 30);
    assert.equal(bodyOf(await call(cookie).put('/api/account/retention').send({ days: 31 })), false);
    assert.equal(bodyOf(await call(cookie).put('/api/account/retention').send({ days: null })), true);
    assert.equal((await db.organization.findUniqueOrThrow({ where: { id: u.orgId } })).rawRetentionDays, null);
  });

  it('close: the password again, then signed out; the closed page and reopening use the closed org\'s session', async () => {
    const u = await fx.user();
    const cookie = await sessionCookie(u);
    assert.deepEqual(bodyOf(await call(cookie).post('/api/account/close').send({ password: 'wrong' })), { error: ta.security.passwordWrong });
    const closed = await call(cookie).post('/api/account/close').send({ password: u.password });
    assert.deepEqual(bodyOf(closed), { redirect: '/sign-in?error=closed' });
    assert.match(setCookies(closed).find((l) => l.startsWith(`${SESSION_COOKIE}=`)) ?? '', /Max-Age=0/);
    assert.ok((await db.organization.findUniqueOrThrow({ where: { id: u.orgId } })).deletedAt);
    // Every session of the org ended; the admin signs in again (allowed for a closed org's admin).
    assert.equal((await call(cookie).get('/api/auth/me')).status, 401);

    const again = await sessionCookie(u);
    assert.equal((await call(again).get('/api/auth/me')).status, 401, 'the session guard refuses a closed org');
    const status = bodyOf<{ purgeOn: string; canReopen: boolean }>(await call(again).get('/api/account/closed'));
    assert.equal(status.canReopen, true);
    assert.ok(new Date(status.purgeOn) > new Date());
    const viewer = await fx.member(u, 'viewer');
    assert.deepEqual(bodyOf(await call(await sessionCookie(viewer)).get('/api/account/closed')), { purgeOn: status.purgeOn, canReopen: false });
    assert.deepEqual(bodyOf(await call(await sessionCookie(viewer)).post('/api/account/reopen')), { redirect: '/account-deleted' });

    assert.equal((await call().get('/api/account/closed')).status, 401);
    assert.deepEqual(bodyOf(await call().post('/api/account/reopen')), { redirect: '/sign-in' });
    assert.deepEqual(bodyOf(await call(again).post('/api/account/reopen')), { redirect: '/dashboard' });
    assert.equal((await db.organization.findUniqueOrThrow({ where: { id: u.orgId } })).deletedAt, null);
    assert.equal((await call(again).get('/api/auth/me')).status, 200);
    assert.deepEqual(bodyOf(await call(again).get('/api/account/closed')), { purgeOn: null, canReopen: true });
  });

  it('the export is a zip for an admin, recorded in the log; refused for other roles', async () => {
    const u = await fx.user();
    const res = await call(await sessionCookie(u)).get('/api/account/export').buffer(true).parse(binary);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/zip');
    assert.match(String(res.headers['content-disposition']), /^attachment; filename="mxik-audit-export-\d{4}-\d\d-\d\d\.zip"$/);
    const zip = await JSZip.loadAsync(res.body as Buffer);
    assert.ok(zip.file('organization.json') && zip.file('team.json'));
    assert.equal(await db.auditEvent.count({ where: { orgId: u.orgId, action: 'account.exported' } }), 1);
    const viewer = await fx.member(u, 'viewer');
    assert.equal((await call(await sessionCookie(viewer)).get('/api/account/export')).status, 403);
  });

  it('language, theme and sidebar set the web app\'s cookies; the language is saved for a signed-in user', async () => {
    const u = await fx.user();
    const res = await call(await sessionCookie(u)).put('/api/account/locale').send({ locale: 'ru' });
    assert.deepEqual(bodyOf(res), { ok: true });
    assert.deepEqual(setCookies(res), ['mxik_locale=ru; Max-Age=31536000; Path=/; SameSite=Lax']);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.userId } })).locale, 'ru');
    assert.deepEqual(bodyOf(await call().put('/api/account/locale').send({ locale: 'uz' })), { ok: true });
    assert.equal((await call().put('/api/account/locale').send({ locale: 'en' })).status, 400);

    const theme = await call().put('/api/account/theme').send({ theme: 'dark' });
    assert.deepEqual([bodyOf(theme), setCookies(theme)], [{ ok: true }, ['mxik_theme=dark; Max-Age=31536000; Path=/; SameSite=Lax']]);
    const sidebar = await call().put('/api/account/sidebar').send({ state: 'collapsed' });
    assert.deepEqual([bodyOf(sidebar), setCookies(sidebar)], [{ ok: true }, ['mxik_sidebar=collapsed; Max-Age=31536000; Path=/; SameSite=Lax']]);
  });

  it('PUT /api/account/tour stamps and clears the user\'s tour flag, for every role; a demo is a no-op; 401 without a session', async () => {
    const u = await fx.user();
    const cookie = await sessionCookie(u);
    const flag = async (userId: string) => (await db.user.findUniqueOrThrow({ where: { id: userId } })).tourCompletedAt;
    const tour = async (c: string) => bodyOf<{ tour: string }>(await call(c).get('/api/shell')).tour;
    assert.equal(await flag(u.userId), null);
    assert.equal(await tour(cookie), 'pending');

    const before = Date.now();
    assert.deepEqual(bodyOf(await call(cookie).put('/api/account/tour').send({ done: true })), { ok: true });
    assert.ok(((await flag(u.userId))?.getTime() ?? 0) >= before - 1000);
    assert.equal(await tour(cookie), 'done');
    assert.deepEqual(bodyOf(await call(cookie).put('/api/account/tour').send({ done: false })), { ok: true });
    assert.equal(await flag(u.userId), null);
    assert.equal(await tour(cookie), 'pending');

    // Only the caller's own row changes; viewers take the tour too.
    const viewer = await fx.member(u, 'viewer');
    const res = await call(await sessionCookie(viewer)).put('/api/account/tour').send({ done: true });
    assert.deepEqual([res.status, bodyOf(res)], [200, { ok: true }]);
    assert.ok(await flag(viewer.userId));
    assert.equal(await flag(u.userId), null);

    assert.equal((await call(cookie).put('/api/account/tour').send({ done: 'yes' })).status, 400);
    assert.equal((await call(cookie).put('/api/account/tour').send({})).status, 400);
    assert.equal((await call().put('/api/account/tour').send({ done: true })).status, 401);
    assert.equal((await call(cookie).put('/api/account/tour').unset('X-Requested-With').send({ done: true })).status, 403);

    const demo = await fx.user({ kind: 'demo', expiresAt: new Date(Date.now() + 3_600_000) });
    const demoCookie = await sessionCookie(demo, { demo: true });
    assert.deepEqual(bodyOf(await call(demoCookie).put('/api/account/tour').send({ done: true })), { ok: true });
    assert.equal(await flag(demo.userId), null);
    assert.equal(await tour(demoCookie), 'done');
    // A demo org is recognised from the database too, whatever the session says.
    const plain = await sessionCookie(demo);
    assert.deepEqual(bodyOf(await call(plain).put('/api/account/tour').send({ done: true })), { ok: true });
    assert.equal(await flag(demo.userId), null);
    assert.equal(await tour(plain), 'done');
  });

  it('Telegram chats: the list, a link code only while the bot is on, unlink; the webhook is off without a bot', async () => {
    const u = await fx.user();
    const cookie = await sessionCookie(u);
    const link = await db.telegramLink.create({ data: { orgId: u.orgId, chatId: `chat-${u.userId}`, username: 'buxgalter', linkedBy: u.userId } });
    const view = bodyOf<{ enabled: boolean; links: { id: string; linkedBy: string | null; createdAt: string }[] }>(await call(cookie).get('/api/account/telegram'));
    assert.equal(view.enabled, false);
    assert.deepEqual(view.links.map((l) => [l.id, l.linkedBy]), [[link.id, u.email]]);

    assert.deepEqual(bodyOf(await call(cookie).post('/api/account/telegram/code')), { ok: false });
    const code = await withEnv(TELEGRAM_ON, async () => bodyOf<{ ok: boolean; code: string; minutes: number }>(await call(cookie).post('/api/account/telegram/code')));
    assert.equal(code.ok, true);
    assert.match(code.code, /^[A-Z0-9]{8}$/);
    assert.equal(code.minutes, 15);

    assert.deepEqual(bodyOf(await call(cookie).delete('/api/account/telegram/nope')), { ok: false });
    assert.deepEqual(bodyOf(await call(cookie).delete(`/api/account/telegram/${link.id}`)), { ok: true });

    const hook = await call().post('/api/telegram/webhook').unset('X-Requested-With').send({ update_id: 1 });
    assert.equal(hook.status, 404);
    const noSecret = await withEnv(TELEGRAM_ON, () => call().post('/api/telegram/webhook').unset('X-Requested-With').send({ update_id: 1 }));
    assert.equal(noSecret.status, 503);
  });

  it('API keys: create (shown once), list with the creator, a bad name, the limit, revoke', async () => {
    const u = await fx.user();
    const cookie = await sessionCookie(u);
    const created = bodyOf<{ token: string }>(await call(cookie).post('/api/account/api-keys').send({ name: '  1C  ' }));
    assert.match(created.token, /^mxk_/);
    const list = bodyOf<{ keys: { id: string; name: string; createdBy: string | null; creatorRemoved: boolean; lastUsedAt: string | null }[]; maxActive: number; monthlyCap: number | null }>(
      await call(cookie).get('/api/account/api-keys'));
    assert.equal(list.maxActive, 10);
    assert.equal(list.monthlyCap, 500);
    assert.deepEqual(list.keys.map((k) => [k.name, k.createdBy, k.creatorRemoved, k.lastUsedAt]), [['1C', u.email, false, null]]);

    assert.deepEqual(bodyOf(await call(cookie).post('/api/account/api-keys').send({ name: '   ' })), { error: 'name' });
    for (let i = 0; i < 9; i++) await call(cookie).post('/api/account/api-keys').send({ name: `k${i}` });
    assert.deepEqual(bodyOf(await call(cookie).post('/api/account/api-keys').send({ name: 'one too many' })), { error: 'limit' });

    const id = list.keys[0]!.id;
    assert.equal(bodyOf(await call(cookie).delete(`/api/account/api-keys/${id}`)), true);
    assert.equal(bodyOf(await call(cookie).delete(`/api/account/api-keys/${id}`)), false);
    const accountant = await fx.member(u, 'accountant');
    assert.equal((await call(await sessionCookie(accountant)).get('/api/account/api-keys')).status, 403);
  });

  it('the activity log: rows with the pickers; filters as applied, unreadable and reversed days reported', async () => {
    const u = await fx.user();
    const cookie = await sessionCookie(u);
    await call(cookie).put('/api/account/retention').send({ days: 7 });
    type Log = { rows: { action: string; actor: string | null; at: string }[]; total: number; users: { email: string }[]; applied: { from: string | null; to: string | null; category: string }; unreadable: boolean; swapped: boolean };
    const log = bodyOf<Log>(await call(cookie).get('/api/activity'));
    assert.ok(log.rows.some((r) => r.action === 'retention.changed' && r.actor === u.email));
    assert.ok(log.total >= 1);
    assert.deepEqual(log.users.map((x) => x.email), [u.email]);

    const odd = bodyOf<Log>(await call(cookie).get('/api/activity?from=31.12.2099&to=2001-01-01&category=team'));
    assert.deepEqual([odd.applied.from, odd.applied.to, odd.applied.category, odd.swapped, odd.unreadable], ['2001-01-01', '2099-12-31', 'team', true, false]);
    const unreadable = bodyOf<Log>(await call(cookie).get('/api/activity?from=abc'));
    assert.deepEqual([unreadable.applied.from, unreadable.unreadable], [null, true]);
    assert.equal((await call(cookie).get('/api/activity?category=nope')).status, 400);
  });
});
