// endpoints.auth, signed-in half: password change, sessions, two-factor setup, the security panel,
// and Telegram sign-in (login callback, binding), against the development database.
import '../setup-env';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { db } from '@tasnivo/db';
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

  it('two-factor setup: start, a wrong code, finish; recovery codes renew; off', async () => {
    const u = await fx.user();
    const cookie = await sessionCookie(u);
    assert.deepEqual(bodyOf(await call(cookie).get('/api/auth/2fa')), { enabled: false, recoveryLeft: 0 });
    const start = bodyOf<{ secret: string; uri: string; qr: { size: number; path: string } }>(await call(cookie).post('/api/auth/2fa/start'));
    assert.match(start.uri, /^otpauth:\/\/totp\//);
    assert.ok(start.qr.size > 20 && start.qr.path.startsWith('M'));

    assert.equal(bodyOf(await call(cookie).post('/api/auth/2fa/finish').send({ code: '000000' })), null);
    const short = await call(cookie).post('/api/auth/2fa/finish').send({ code: '123' });
    assert.equal(short.status, 400);
    const codes = bodyOf<string[]>(await call(cookie).post('/api/auth/2fa/finish').send({ code: codeAt(start.secret, stepOf()) }));
    assert.equal(codes.length, 8);
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
    const off = await call().get(`/api/auth/telegram?${query(telegramData('1'))}`);
    assert.equal(off.status, 307);
    assert.equal(off.headers['location'], '/sign-in');

    const u = await fx.user();
    const id = telegramId();
    await db.user.update({ where: { id: u.userId }, data: { telegramUserId: id } });
    const chat = telegramId();
    await db.telegramLink.create({ data: { orgId: u.orgId, chatId: chat, linkedBy: u.userId } });

    await withEnv(TELEGRAM_ON, async () => {
      const data = telegramData(id);
      const res = await call().get(`/api/auth/telegram?${query(data)}`);
      assert.equal(res.status, 307);
      assert.equal(res.headers['location'], '/dashboard');
      assert.equal((await call(sessionPair(res)).get('/api/auth/me')).status, 200);

      const replay = await call().get(`/api/auth/telegram?${query(data)}`);
      assert.equal(replay.headers['location'], '/sign-in?error=telegram_expired');
      const unsigned = await call().get(`/api/auth/telegram?${query({ ...telegramData(id), hash: 'ab'.repeat(32) })}`);
      assert.equal(unsigned.headers['location'], '/sign-in?error=telegram_invalid');
      const notification = await call().get(`/api/auth/telegram?${query(telegramData(chat))}`);
      assert.equal(notification.headers['location'], '/sign-in?error=telegram_unbound');
    });
  });
});
