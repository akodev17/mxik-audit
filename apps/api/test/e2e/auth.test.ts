// endpoints.auth, public half: me, sign-in and sign-out, two-factor sign-in, sign-up and its code
// step, password reset, the confirmation link and the start of Google sign-in, against the
// development database through the real app.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { sealData } from 'iron-session';
import { db } from '@tasnivo/db';
import { issueCode } from '@tasnivo/domain/security/email-code';
import { issueToken } from '@tasnivo/domain/security/email-token';
import { issueResetToken } from '@tasnivo/domain/security/password-reset';
import { createRecord } from '@tasnivo/domain/security/session-store';
import { beginSetup, confirmSetup } from '@tasnivo/domain/security/two-factor';
import { codeAt, stepOf } from '@tasnivo/domain/security/totp';
import { sessionOptions, type CurrentUser, type SessionData } from '@tasnivo/domain/session';
import { i18nFor } from '@tasnivo/i18n/locale';
import { SESSION_COOKIE } from '../../src/auth-core/session.service';
import { bodyOf, cookiePair, dbSkipReason, setCookies, startApp, testIp } from '../helpers';
import { catchMail, client, Fixtures, MAIL_ON, quietEnv, sessionPair, unsealPair, withEnv } from '../session-helpers';

const skip = await dbSkipReason();
const { t, ta } = i18nFor('uz');

type State = { redirect?: string; error?: string; unverified?: boolean; info?: string; sent?: boolean; checkEmail?: boolean };

describe('auth: sign-in, sign-up, password, confirmation (database)', { skip }, () => {
  let app: INestApplication;
  let call: ReturnType<typeof client>;
  const fx = new Fixtures();
  const restoreEnv = quietEnv();
  const signIn = (body: object, ip = testIp(), cookie?: string) => call(cookie, ip).post('/api/auth/sign-in').send(body);
  const me = (cookie?: string) => call(cookie).get('/api/auth/me');

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

  it('GET /api/auth/me without a cookie, or with a garbage one, is 401', async () => {
    const none = await me();
    assert.equal(none.status, 401);
    assert.deepEqual(bodyOf(none), { error: { code: 'unauthorized', message: 'Sign in to continue.' } });
    assert.equal((await me(`${SESSION_COOKIE}=not-a-seal`)).status, 401);
  });

  it('signs in with the web app\'s cookie (same name, seal and options); me answers the CurrentUser', async () => {
    const u = await fx.user();
    const res = await signIn({ email: `  ${u.email.toUpperCase()} `, password: u.password, next: '/catalogs?x=1' });
    assert.equal(res.status, 200, JSON.stringify(bodyOf(res)));
    assert.deepEqual(bodyOf<State>(res), { redirect: '/catalogs?x=1' });

    const line = setCookies(res).find((l) => l.startsWith(`${SESSION_COOKIE}=`)) ?? '';
    assert.match(line, /; Max-Age=604800/);
    assert.match(line, /; Path=\//);
    assert.match(line, /; HttpOnly/);
    assert.match(line, /; SameSite=Lax/);

    const pair = sessionPair(res)!;
    const data = await unsealPair(pair);
    assert.deepEqual([data.userId, data.orgId, data.email, data.demo], [u.userId, u.orgId, u.email, false]);
    const record = await db.userSession.findUniqueOrThrow({ where: { id: data.sid! } });
    assert.equal(record.userAgent, 'api-e2e');

    const who = await me(pair);
    assert.equal(who.status, 200);
    assert.deepEqual(bodyOf<CurrentUser>(who), { userId: u.userId, orgId: u.orgId, email: u.email, demo: false, clientId: null, role: 'admin', clientIds: null, verified: true });
  });

  it('an unsafe next falls back to /dashboard; a saved interface language comes back as the locale cookie', async () => {
    const u = await fx.user({ locale: 'ru' });
    const res = await signIn({ email: u.email, password: u.password, next: '//evil.example' });
    assert.deepEqual(bodyOf<State>(res), { redirect: '/dashboard' });
    const locale = setCookies(res).find((l) => l.startsWith('mxik_locale=')) ?? '';
    assert.match(locale, /^mxik_locale=ru; Max-Age=31536000; Path=\/; SameSite=Lax$/);
  });

  it('a wrong password answers the form\'s message in the request\'s language, and sets no cookie', async () => {
    const u = await fx.user();
    const uz = await signIn({ email: u.email, password: 'wrong-password' });
    assert.equal(uz.status, 200);
    assert.deepEqual(bodyOf<State>(uz), { error: t.signInError });
    assert.equal(setCookies(uz).length, 0);
    const ru = await call(`mxik_locale=ru`).post('/api/auth/sign-in').send({ email: `nobody-${testIp()}@test.local`, password: 'x' });
    assert.deepEqual(bodyOf<State>(ru), { error: i18nFor('ru').t.signInError });
    // A malformed address answers exactly like a wrong password.
    assert.deepEqual(bodyOf(await signIn({ email: 'not-an-email', password: 'x' })), bodyOf(uz));
  });

  it('after five wrong passwords for one address the sixth try is refused, even with the right password', async () => {
    const u = await fx.user();
    for (let i = 0; i < 5; i++) assert.deepEqual(bodyOf<State>(await signIn({ email: u.email, password: `wrong-${i}` })), { error: t.signInError });
    const limited = await signIn({ email: u.email, password: u.password });
    assert.match(bodyOf<State>(limited).error ?? '', /\d/);
    assert.notEqual(bodyOf<State>(limited).error, t.signInError);
    assert.equal(setCookies(limited).length, 0);
  });

  it('the per-address limit counts every attempt from one client address', async () => {
    const ip = testIp();
    for (let i = 0; i < 30; i++) await signIn({ email: 'not-an-email', password: 'x' }, ip);
    // Malformed addresses never reach the counter; well-formed ones do.
    const u = await fx.user();
    for (let i = 0; i < 30; i++) await signIn({ email: `nobody-${i}@test.local`, password: 'x' }, ip);
    const limited = await signIn({ email: u.email, password: u.password }, ip);
    assert.equal(bodyOf<State>(limited).error, ta.secX.tooMany(15));
  });

  it('two-factor: the pending state, a wrong code, then the right code signs in', async () => {
    const u = await fx.user();
    const setup = (await beginSetup(u.userId, u.email))!;
    await confirmSetup(u, codeAt(setup.secret, stepOf() - 1));
    const res = await signIn({ email: u.email, password: u.password });
    assert.deepEqual(bodyOf<State>(res), { redirect: '/sign-in/2fa' });
    const pending = sessionPair(res)!;
    assert.equal((await unsealPair(pending)).pendingUserId, u.userId);
    assert.equal((await me(pending)).status, 401);
    assert.deepEqual(bodyOf(await call(pending).get('/api/auth/2fa/pending')), { pending: true });
    assert.deepEqual(bodyOf(await call().get('/api/auth/2fa/pending')), { pending: false });

    const wrong = await call(pending).post('/api/auth/2fa/submit').send({ code: '000000' });
    assert.deepEqual(bodyOf<State>(wrong), { error: ta.security.codeWrong });
    const ok = await call(pending).post('/api/auth/2fa/submit').send({ code: codeAt(setup.secret, stepOf()) });
    assert.deepEqual(bodyOf<State>(ok), { redirect: '/dashboard' });
    assert.equal((await me(sessionPair(ok))).status, 200);
  });

  it('two-factor submit without a pending sign-in goes back to sign-in (expired)', async () => {
    const res = await call().post('/api/auth/2fa/submit').send({ code: '123456' });
    assert.deepEqual(bodyOf<State>(res), { redirect: '/sign-in?error=2fa_expired' });
  });

  it('sign-out ends the session record and clears the cookie; works without a session', async () => {
    const u = await fx.user();
    const pair = sessionPair(await signIn({ email: u.email, password: u.password }))!;
    const out = await call(pair).post('/api/auth/sign-out');
    assert.equal(out.status, 200);
    assert.deepEqual(bodyOf(out), { redirect: '/sign-in' });
    assert.match(setCookies(out).find((l) => l.startsWith(`${SESSION_COOKIE}=`)) ?? '', new RegExp(`^${SESSION_COOKIE}=;.*Max-Age=0`));
    assert.equal((await me(pair)).status, 401);
    assert.deepEqual(bodyOf(await call().post('/api/auth/sign-out')), { redirect: '/sign-in' });
  });

  it('a demo org past its end is rejected even with a live session record', async () => {
    const u = await fx.user({ kind: 'demo', expiresAt: new Date(Date.now() - 60_000) });
    const sid = await createRecord(u.userId, u.orgId, 'api-e2e');
    const seal = await sealData({ userId: u.userId, orgId: u.orgId, email: u.email, demo: true, sid } satisfies SessionData, { password: sessionOptions.password });
    assert.equal((await me(`${SESSION_COOKIE}=${seal}`)).status, 401);
  });

  it('sign-up opens a trial org and signs its admin in to the code step only; the code opens the rest; a taken or malformed address is refused', async () => {
    const email = `signup-${testIp()}@example.com`.toLowerCase();
    const res = await call().post('/api/auth/sign-up').send({ email, password: 'long-enough-1', firm: '  Hisob   Pro ' });
    await fx.adopt(email);
    assert.deepEqual(bodyOf<State>(res), { redirect: '/sign-up/verify' });
    const row = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true, role: true, emailVerifiedAt: true, org: { select: { name: true, trialEndsAt: true } } } });
    assert.equal(row.role, 'admin');
    assert.equal(row.emailVerifiedAt, null);
    assert.equal(row.org.name, 'Hisob Pro');
    assert.ok(row.org.trialEndsAt && row.org.trialEndsAt.getTime() - Date.now() > 13.9 * 86_400_000);
    const pair = sessionPair(res);
    const who = await me(pair);
    assert.equal(who.status, 200);
    assert.equal(bodyOf<{ verified: boolean }>(who).verified, false);

    // Unconfirmed: every other session endpoint answers 403 unverified.
    for (const path of ['/api/auth/sessions', '/api/catalogs', '/api/shell']) {
      const refused = await call(pair).get(path);
      assert.equal(refused.status, 403, path);
      assert.equal(bodyOf(refused).error.code, 'unverified');
    }
    const code = await issueCode(row.id);
    const wrong = code === '000000' ? '111111' : '000000';
    assert.deepEqual(bodyOf<State>(await call(pair).post('/api/auth/verify-code').send({ code: wrong })), { error: ta.verifyX.wrong });
    assert.deepEqual(bodyOf<State>(await call(pair).post('/api/auth/verify-code').send({ code })), { redirect: '/dashboard' });
    assert.equal((await call(pair).get('/api/auth/sessions')).status, 200);
    assert.equal(bodyOf<{ verified: boolean }>(await me(pair)).verified, true);

    // The address is taken: the owner gets a mail, the visitor the "check your e-mail" answer.
    assert.deepEqual(bodyOf<State>(await call().post('/api/auth/sign-up').send({ email, password: 'long-enough-1', firm: 'x' })), { checkEmail: true });
    assert.deepEqual(bodyOf<State>(await call().post('/api/auth/sign-up').send({ email: 'bad', password: 'long-enough-1', firm: 'x' })), { error: ta.msg.account.emailBad });
    assert.deepEqual(bodyOf<State>(await call().post('/api/auth/sign-up').send({ email: 'x@example.com', password: 'short', firm: 'x' })), { error: ta.msg.account.passwordShort });
  });

  it('sign-up is limited per client address (8 an hour)', async () => {
    const ip = testIp();
    for (let i = 0; i < 8; i++) await call(undefined, ip).post('/api/auth/sign-up').send({ email: 'bad', password: 'x', firm: 'x' });
    const limited = await call(undefined, ip).post('/api/auth/sign-up').send({ email: 'bad', password: 'x', firm: 'x' });
    assert.match(bodyOf<State>(limited).error ?? '', /\d/);
    assert.notEqual(bodyOf<State>(limited).error, ta.msg.account.emailBad);
  });

  it('a body of the wrong shape is 400 with the issues; a mutation without the CSRF header is 403', async () => {
    const bad = await call().post('/api/auth/sign-up').send({ email: 1 });
    assert.equal(bad.status, 400);
    assert.equal(bodyOf(bad).error.code, 'invalid_request');
    const unguarded = await call().post('/api/auth/sign-in').unset('X-Requested-With').send({ email: 'a@b.uz', password: 'x' });
    assert.equal(unguarded.status, 403);
    assert.equal(bodyOf(unguarded).error.code, 'csrf');
  });

  it('forgot password: refused without mail (production without SMTP); with mail it queues a reset link, same answer for an unknown address', async () => {
    const noMail = await withEnv({ NODE_ENV: 'production' }, async () => bodyOf<State>(await call().post('/api/auth/password/forgot').send({ email: 'a@b.uz' })));
    assert.deepEqual(noMail, { error: ta.secX.forgot.noMail });
    const u = await fx.user();
    const caught = catchMail();
    try {
      await withEnv(MAIL_ON, async () => {
        assert.deepEqual(bodyOf<State>(await call().post('/api/auth/password/forgot').send({ email: u.email })), { sent: true });
        assert.deepEqual(bodyOf<State>(await call().post('/api/auth/password/forgot').send({ email: `nobody-${testIp()}@test.local` })), { sent: true });
        assert.deepEqual(bodyOf<State>(await call().post('/api/auth/password/forgot').send({ email: 'nope' })), { error: ta.msg.account.emailBad });
      });
    } finally {
      caught.restore();
    }
    assert.equal(caught.mails.length, 1);
    assert.equal(caught.mails[0]!.to, u.email);
    assert.match(caught.mails[0]!.text, /\/reset\/[\w-]+/);
  });

  it('reset: the target of a link, a mismatch, then the new password; the link works once', async () => {
    const u = await fx.user();
    assert.deepEqual(bodyOf(await call().get('/api/auth/password/reset/not-a-token')), { email: null, passwordMin: 8 });
    const token = await issueResetToken(u.userId);
    assert.deepEqual(bodyOf(await call().get(`/api/auth/password/reset/${token}`)), { email: u.email, passwordMin: 8 });
    const path = `/api/auth/password/reset/${token}`;
    assert.deepEqual(bodyOf<State>(await call().post(path).send({ password: 'new-password-1', repeat: 'other' })), { error: ta.secX.reset.mismatch });
    assert.deepEqual(bodyOf<State>(await call().post(path).send({ password: 'short', repeat: 'short' })), { error: ta.secX.password.short(8) });
    assert.deepEqual(bodyOf<State>(await call().post(path).send({ password: 'new-password-1', repeat: 'new-password-1' })), { redirect: '/sign-in?notice=reset_done' });
    assert.deepEqual(bodyOf<State>(await call().post(path).send({ password: 'new-password-2', repeat: 'new-password-2' })), { error: ta.secX.reset.badHint });
    assert.deepEqual(bodyOf<State>(await signIn({ email: u.email, password: 'new-password-1' })), { redirect: '/dashboard' });
  });

  it('resend confirmation answers the same whatever happens', async () => {
    const res = await call().post('/api/auth/confirmation/resend').send({ email: `nobody-${testIp()}@test.local`, password: 'x' });
    assert.deepEqual(bodyOf<State>(res), { info: ta.secX.resendSent });
    assert.deepEqual(bodyOf<State>(await call().post('/api/auth/confirmation/resend').send({ email: 'bad', password: '' })), { info: ta.secX.resendSent });
  });

  it('the confirmation link confirms the address and signs in; a bad link goes to sign-in with the notice', async () => {
    const bad = await call().get('/api/auth/verify/not-a-token');
    assert.equal(bad.status, 307);
    assert.equal(bad.headers['location'], '/sign-in?error=verify');

    const u = await fx.user();
    await db.user.update({ where: { id: u.userId }, data: { emailVerifiedAt: null } });
    const token = await issueToken(u.userId, 'verify', 3_600_000);
    const res = await call().get(`/api/auth/verify/${token}`);
    assert.equal(res.status, 307);
    assert.equal(res.headers['location'], '/dashboard');
    assert.ok((await db.user.findUniqueOrThrow({ where: { id: u.userId } })).emailVerifiedAt);
    assert.equal((await me(cookiePair(setCookies(res), SESSION_COOKIE))).status, 200);
  });

  it('an unconfirmed address signs in to the code step, whatever next says; resend mails a new code there', async () => {
    const u = await fx.user();
    await db.user.update({ where: { id: u.userId }, data: { emailVerifiedAt: null } });
    const res = await withEnv(MAIL_ON, () => signIn({ email: u.email, password: u.password, next: '/catalogs' }));
    assert.deepEqual(bodyOf<State>(res), { redirect: '/sign-up/verify' });
    const pair = sessionPair(res);
    assert.equal((await call(pair).get('/api/catalogs')).status, 403);
    const before = await db.emailCode.count({ where: { userId: u.userId } });
    assert.deepEqual(bodyOf<State>(await call(pair).post('/api/auth/verify-code/resend')), { info: ta.verifyX.resent });
    assert.equal(await db.emailCode.count({ where: { userId: u.userId } }), before + 1);
    // Without a session the code step is 401, like any session endpoint.
    assert.equal((await call().post('/api/auth/verify-code').send({ code: '123456' })).status, 401);
  });

  it('GET /api/auth/config says what the sign-in pages offer', async () => {
    const config = await withEnv({ GOOGLE_CLIENT_ID: undefined }, async () => bodyOf(await call().get('/api/auth/config')));
    assert.deepEqual(config, { telegramBot: null, mailEnabled: false, google: false });
  });

  it('Google sign-in starts only when configured: PKCE, state and nonce, kept in the session cookie', async () => {
    const off = await withEnv({ GOOGLE_CLIENT_ID: undefined }, () => call().get('/api/auth/google'));
    assert.equal(off.status, 307);
    assert.equal(off.headers['location'], '/sign-in');
    await withEnv({ GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', APP_URL: 'https://tasnivo.test', GOOGLE_REDIRECT_URI: undefined }, async () => {
      assert.equal(bodyOf<{ google: boolean }>(await call().get('/api/auth/config')).google, true);
      const res = await call().get('/api/auth/google?next=/catalogs');
      assert.equal(res.status, 302);
      const url = new URL(res.headers['location'] ?? '');
      assert.equal(url.host, 'accounts.google.com');
      assert.equal(url.searchParams.get('redirect_uri'), 'https://tasnivo.test/api/auth/google/callback');
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      const pair = sessionPair(res);
      const data = await unsealPair(pair!);
      assert.equal(data.google?.state, url.searchParams.get('state'));
      assert.equal(data.google?.next, '/catalogs');
      // A callback whose state is not this browser's goes back to sign-in.
      const forged = await call(pair).get('/api/auth/google/callback?code=x&state=forged');
      assert.equal(forged.status, 307);
      assert.equal(forged.headers['location'], '/sign-in?error=google_state');
    });
  });
});
