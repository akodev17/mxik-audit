// endpoints.auth, signed-in half: password change, sessions (and their 30-day limit), two-factor
// setup, the security panel, Telegram sign-in (login callback with its one-time state, binding) and
// Google never joining an unconfirmed account, against the development database.
import '../setup-env';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { db } from '@tasnivo/db';
import { googleUser } from '@tasnivo/domain/security/google';
import { codeAt, stepOf } from '@tasnivo/domain/security/totp';
import { i18nFor } from '@tasnivo/i18n/locale';
import { bodyOf, dbSkipReason, startApp } from '../helpers';
import { client, Fixtures, query, quietEnv, sessionCookie, sessionPair, telegramData, TELEGRAM_ON, unsealPair, withEnv } from '../session-helpers';

const skip = await dbSkipReason();
const { ta } = i18nFor('uz');

type Row = { id: string; device: string; current: boolean; userAgent: string | null; createdAt: string; lastSeenAt: string };
const telegramId = (): string => String(9_000_000_000 + randomInt(1_000_000_000));

describe('auth: security settings and Telegram sign-in (database)', { skip }, () => {
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

  it('change password: a wrong current one is refused; the right one ends the other sessions only', async () => {
    const u = await fx.user();
    const mine = await sessionCookie(u);
    const other = await sessionCookie(u);
    const wrong = await call(mine).post('/api/auth/password/change').send({ current: 'nope', next: 'brand-new-pass' });
    assert.deepEqual(bodyOf(wrong), { error: ta.secX.password.wrong });
    const short = await call(mine).post('/api/auth/password/change').send({ current: u.password, next: 'short' });
    assert.deepEqual(bodyOf(short), { error: ta.secX.password.short(8) });
    const ok = await call(mine).post('/api/auth/password/change').send({ current: u.password, next: 'brand-new-pass' });
    assert.deepEqual(bodyOf(ok), { done: ta.secX.password.done(1) });
    assert.equal((await call(mine).get('/api/auth/me')).status, 200);
    assert.equal((await call(other).get('/api/auth/me')).status, 401);
  });

  it('change password is limited to five tries per user, refused for a demo org and without CSRF', async () => {
    const u = await fx.user();
    const cookie = await sessionCookie(u);
    for (let i = 0; i < 5; i++) await call(cookie).post('/api/auth/password/change').send({ current: 'nope', next: 'brand-new-pass' });
    const limited = await call(cookie).post('/api/auth/password/change').send({ current: u.password, next: 'brand-new-pass' });
    assert.equal(bodyOf<{ error: string }>(limited).error, ta.secX.tooMany(15));

    const demo = await fx.user({ kind: 'demo', expiresAt: new Date(Date.now() + 3_600_000) });
    const refused = await call(await sessionCookie(demo)).post('/api/auth/password/change').send({ current: demo.password, next: 'brand-new-pass' });
    assert.equal(refused.status, 403);
    assert.equal(bodyOf(refused).error.code, 'demo');

    const noCsrf = await call(cookie).post('/api/auth/password/change').unset('X-Requested-With').send({ current: 'a', next: 'b' });
    assert.equal(noCsrf.status, 403);
    assert.equal(bodyOf(noCsrf).error.code, 'csrf');
  });

  it('sessions: this browser first with a device label; end one, then every other', async () => {
    const u = await fx.user();
    const a = await sessionCookie(u);
    const b = await sessionCookie(u);
    const c = await sessionCookie(u);
    const rows = bodyOf<Row[]>(await call(b).get('/api/auth/sessions'));
    assert.equal(rows.length, 3);
    const bSid = (await unsealPair(b)).sid;
    assert.deepEqual(rows.map((r) => r.current), [true, false, false]);
    assert.equal(rows[0]!.id, bSid);
    assert.equal(rows[0]!.device, 'Chrome 130, Windows');
    assert.match(rows[0]!.createdAt, /^\d{4}-\d\d-\d\dT.*Z$/);

    const aSid = (await unsealPair(a)).sid!;
    assert.equal(bodyOf(await call(b).delete(`/api/auth/sessions/${aSid}`)), true);
    assert.equal(bodyOf(await call(b).delete(`/api/auth/sessions/${aSid}`)), false);
    assert.equal((await call(a).get('/api/auth/me')).status, 401);
    assert.equal(bodyOf(await call(b).post('/api/auth/sessions/end-others')), 1);
    assert.equal((await call(c).get('/api/auth/me')).status, 401);
    assert.equal((await call(b).get('/api/auth/me')).status, 200);

    // Someone else's session id ends nothing.
    const stranger = await fx.user();
    const theirs = await sessionCookie(stranger);
    assert.equal(bodyOf(await call(b).delete(`/api/auth/sessions/${(await unsealPair(theirs)).sid}`)), false);
    assert.equal((await call(theirs).get('/api/auth/me')).status, 200);
  });

  it('two-factor setup: start, a wrong code, finish (every other session ends, F20); recovery codes renew; off', async () => {
    const u = await fx.user();
    const cookie = await sessionCookie(u);
    const other = await sessionCookie(u);
    assert.deepEqual(bodyOf(await call(cookie).get('/api/auth/2fa')), { enabled: false, recoveryLeft: 0 });
    const start = bodyOf<{ secret: string; uri: string; qr: { size: number; path: string } }>(await call(cookie).post('/api/auth/2fa/start'));
    assert.match(start.uri, /^otpauth:\/\/totp\//);
    assert.ok(start.qr.size > 20 && start.qr.path.startsWith('M'));

    assert.equal(bodyOf(await call(cookie).post('/api/auth/2fa/finish').send({ code: '000000' })), null);
    const short = await call(cookie).post('/api/auth/2fa/finish').send({ code: '123' });
    assert.equal(short.status, 400);
    assert.equal((await call(other).get('/api/auth/me')).status, 200, 'a wrong code ends nothing');
    const codes = bodyOf<string[]>(await call(cookie).post('/api/auth/2fa/finish').send({ code: codeAt(start.secret, stepOf()) }));
    assert.equal(codes.length, 8);
    assert.equal((await call(other).get('/api/auth/me')).status, 401, 'a session opened before two-factor does not outlive it');
    assert.equal((await call(cookie).get('/api/auth/me')).status, 200, 'this browser stays signed in');
    assert.deepEqual((await db.auditEvent.findFirstOrThrow({ where: { orgId: u.orgId, action: 'security.2fa_enabled' } })).payload, { sessionsEnded: 1 });
    assert.deepEqual(bodyOf(await call(cookie).get('/api/auth/2fa')), { enabled: true, recoveryLeft: 8 });
    // Starting again while on answers null.
    assert.equal(bodyOf(await call(cookie).post('/api/auth/2fa/start')), null);

    assert.equal(bodyOf(await call(cookie).post('/api/auth/2fa/recovery-codes').send({ code: 'zzzzz-zzzzz-zzzzz-zzzzz' })), null);
    const renewed = bodyOf<string[]>(await call(cookie).post('/api/auth/2fa/recovery-codes').send({ code: codes[0] }));
    assert.equal(renewed.length, 8);
    assert.equal(bodyOf(await call(cookie).post('/api/auth/2fa/off').send({ code: codes[1] })), false, 'old recovery codes are gone');
    assert.equal(bodyOf(await call(cookie).post('/api/auth/2fa/off').send({ code: renewed[0] })), true);
    assert.deepEqual(bodyOf(await call(cookie).get('/api/auth/2fa')), { enabled: false, recoveryLeft: 0 });
  });

  it('the security panel: Telegram availability and password rules', async () => {
    const u = await fx.realEmail(await fx.user());
    const cookie = await sessionCookie(u);
    assert.deepEqual(bodyOf(await call(cookie).get('/api/auth/security')), {
      telegram: { available: false, bot: null, bound: false, canUnbind: false }, passwordMin: 8, passwordChangeable: true,
    });
    const on = await withEnv(TELEGRAM_ON, async () => bodyOf<{ telegram: { available: boolean; bot: string } }>(await call(cookie).get('/api/auth/security')));
    assert.deepEqual([on.telegram.available, on.telegram.bot], [true, 'tasnivo_test_bot']);
    assert.equal(bodyOf(await call(cookie).post('/api/auth/telegram/bind')), null, 'null while Telegram is off');
  });

  it('Telegram binding: the one-time state from this browser, a signed widget answer, then unbind', async () => {
    const u = await fx.realEmail(await fx.user());
    const cookie = await sessionCookie(u);
    const id = telegramId();

    const noSession = await call().get(`/api/auth/telegram/bind/x?${query(telegramData(id))}`);
    assert.equal(noSession.status, 307);
    assert.equal(noSession.headers['location'], '/sign-in');

    await withEnv(TELEGRAM_ON, async () => {
      const started = await call(cookie).post('/api/auth/telegram/bind');
      const state = bodyOf<string>(started);
      assert.match(state, /^[\w-]{20,}$/);
      const withState = sessionPair(started)!;
      assert.equal((await unsealPair(withState)).tgBind, state);

      const wrong = await call(withState).get(`/api/auth/telegram/bind/not-the-state?${query(telegramData(id))}`);
      assert.equal(wrong.headers['location'], '/settings?tg=error#telegram-sign-in');
      // The state was spent by the wrong try: the cookie it set no longer carries it.
      assert.equal((await unsealPair(sessionPair(wrong)!)).tgBind, undefined);

      const again = sessionPair(await call(cookie).post('/api/auth/telegram/bind'))!;
      const fresh = (await unsealPair(again)).tgBind!;
      const forged = { ...telegramData(id), first_name: 'Changed' };
      assert.equal((await call(again).get(`/api/auth/telegram/bind/${fresh}?${query(forged)}`)).headers['location'], '/settings?tg=error#telegram-sign-in');

      const third = sessionPair(await call(cookie).post('/api/auth/telegram/bind'))!;
      const ok = await call(third).get(`/api/auth/telegram/bind/${(await unsealPair(third)).tgBind}?${query(telegramData(id))}`);
      assert.equal(ok.status, 307);
      assert.equal(ok.headers['location'], '/settings?tg=bound#telegram-sign-in');
    });
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.userId } })).telegramUserId, id);
    assert.equal(bodyOf(await call(cookie).delete('/api/auth/telegram/bind')), true);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.userId } })).telegramUserId, null);
  });

  it('Telegram sign-in: off without a bot; the bound user signs in once per signed answer; a notification chat is refused', async () => {
    assert.equal(bodyOf(await call().post('/api/auth/telegram/login')), null, 'no state while Telegram is off');
    const off = await call().get(`/api/auth/telegram/login/x?${query(telegramData('1'))}`);
    assert.equal(off.status, 307);
    assert.equal(off.headers['location'], '/sign-in');

    const u = await fx.user();
    const id = telegramId();
    await db.user.update({ where: { id: u.userId }, data: { telegramUserId: id } });
    const chat = telegramId();
    await db.telegramLink.create({ data: { orgId: u.orgId, chatId: chat, linkedBy: u.userId } });

    await withEnv(TELEGRAM_ON, async () => {
      /** A browser that opened the sign-in page: its cookie and the state in the widget's callback path. */
      const page = async (): Promise<{ cookie: string; path: (data: Record<string, string>) => string }> => {
        const started = await call().post('/api/auth/telegram/login');
        const state = bodyOf<string>(started);
        return { cookie: sessionPair(started)!, path: (data) => `/api/auth/telegram/login/${state}?${query(data)}` };
      };
      const data = telegramData(id);
      const one = await page();
      const res = await call(one.cookie).get(one.path(data));
      assert.equal(res.status, 307);
      assert.equal(res.headers['location'], '/dashboard');
      assert.equal((await call(sessionPair(res)).get('/api/auth/me')).status, 200);

      const replay = await page();
      assert.equal((await call(replay.cookie).get(replay.path(data))).headers['location'], '/sign-in?error=telegram_expired');
      const unsigned = await page();
      assert.equal((await call(unsigned.cookie).get(unsigned.path({ ...telegramData(id), hash: 'ab'.repeat(32) }))).headers['location'], '/sign-in?error=telegram_invalid');
      const notification = await page();
      assert.equal((await call(notification.cookie).get(notification.path(telegramData(chat)))).headers['location'], '/sign-in?error=telegram_unbound');
    });
  });

  it('Telegram sign-in needs the state this browser got from the sign-in page (login CSRF, F20)', async () => {
    const u = await fx.user();
    const id = telegramId();
    await db.user.update({ where: { id: u.userId }, data: { telegramUserId: id } });
    await withEnv(TELEGRAM_ON, async () => {
      const started = await call().post('/api/auth/telegram/login');
      const state = bodyOf<string>(started);
      assert.match(state, /^[\w-]{20,}$/);
      // The attacker's own signed answer and state, replayed in a victim's browser that holds no state.
      const noCookie = await call().get(`/api/auth/telegram/login/${state}?${query(telegramData(id))}`);
      assert.equal(noCookie.headers['location'], '/sign-in?error=telegram_state');
      assert.equal(await db.userSession.count({ where: { userId: u.userId } }), 0, 'nobody was signed in');
      // A browser with its own state but someone else's path: refused, and its state is spent.
      const wrong = await call(sessionPair(started)).get(`/api/auth/telegram/login/not-the-state?${query(telegramData(id))}`);
      assert.equal(wrong.headers['location'], '/sign-in?error=telegram_state');
      assert.equal((await unsealPair(sessionPair(wrong)!)).tgLogin, undefined);
      assert.equal((await call(sessionPair(wrong)).get(`/api/auth/telegram/login/${state}?${query(telegramData(id))}`)).headers['location'], '/sign-in?error=telegram_state');
    });
  });

  it('a session ends 30 days after its sign-in however active it is (F20)', async () => {
    const u = await fx.user();
    const young = await sessionCookie(u);
    const old = await sessionCookie(u);
    const day = 86_400_000;
    await db.userSession.update({ where: { id: (await unsealPair(young)).sid! }, data: { createdAt: new Date(Date.now() - 29 * day), lastSeenAt: new Date() } });
    await db.userSession.update({ where: { id: (await unsealPair(old)).sid! }, data: { createdAt: new Date(Date.now() - 31 * day), lastSeenAt: new Date() } });
    assert.equal((await call(young).get('/api/auth/me')).status, 200);
    assert.equal((await call(old).get('/api/auth/me')).status, 401);
    assert.deepEqual(bodyOf<Row[]>(await call(young).get('/api/auth/sessions')).map((r) => r.current), [true], 'the expired one is not listed');
  });

  it('Google never binds itself to an account whose address was not confirmed by code or link (F2)', async () => {
    const firm = await fx.user({ plan: 'firm' });
    const victim = `victim-${randomInt(1e9)}@gmail.com`;
    // The admin invites the victim's address and accepts the link with a password of their own.
    const { url } = bodyOf<{ url: string }>(await call(await sessionCookie(firm)).post('/api/team/invites').send({ role: 'viewer', kind: 'email', email: victim }));
    await call().post(`/api/invites/${url.split('/invite/')[1]}/join`).send({ email: victim, password: 'attacker-pass-1' });
    const squat = await db.user.findUniqueOrThrow({ where: { email: victim } });
    assert.equal(squat.emailVerifiedAt, null);

    const identity = { sub: `g-${randomInt(1e9)}`, email: victim, name: null };
    assert.deepEqual(await googleUser(identity, 'test-ip'), { ok: false, error: 'google_unconfirmed' });
    // Confirmed before verifiedVia existed (such invites were confirmed on accept): still not enough.
    await db.user.update({ where: { id: squat.id }, data: { emailVerifiedAt: new Date(), verifiedVia: 'legacy' } });
    assert.deepEqual(await googleUser(identity, 'test-ip'), { ok: false, error: 'google_unconfirmed' });
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: squat.id } })).googleSub, null);
    assert.ok(ta.verifyX.notices['google_unconfirmed'], 'the sign-in page explains it');

    // Once the holder confirms the address with the mailed code, Google may join it.
    await db.user.update({ where: { id: squat.id }, data: { verifiedVia: 'code' } });
    const linked = await googleUser(identity, 'test-ip');
    assert.ok(linked.ok && linked.user.id === squat.id);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: squat.id } })).googleSub, identity.sub);
  });
});
