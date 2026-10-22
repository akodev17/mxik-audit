// Sign-in, me and sign-out against the development database, through the real app.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { sealData, unsealData } from 'iron-session';
import request from 'supertest';
import { db } from '@tasnivo/db';
import { createRecord } from '@tasnivo/domain/security/session-store';
import { sessionOptions, type CurrentUser, type SessionData } from '@tasnivo/domain/session';
import { SESSION_COOKIE } from '../../src/auth-core/session.service';
import type { SignInResponse } from '../../src/auth/dto';
import { bodyOf, cookiePair, dbSkipReason, dropOrgs, makeUser, serverOf, setCookies, startApp, testIp, type TestUser } from '../helpers';

const skip = await dbSkipReason();

type Me = { user: CurrentUser; org: { id: string; kind: string }; role: string; clientIds: string[] | null; locale: string };

/** The fields inside a session cookie, as the web app would unseal them. */
async function unsealPair(pair: string): Promise<SessionData> {
  return unsealData<SessionData>(decodeURIComponent(pair.slice(SESSION_COOKIE.length + 1)), { password: sessionOptions.password });
}

describe('auth routes (database)', { skip }, () => {
  let app: INestApplication;
  const orgs: string[] = [];
  const user = async (options: Parameters<typeof makeUser>[0] = {}): Promise<TestUser> => {
    const u = await makeUser(options);
    orgs.push(u.orgId);
    return u;
  };
  const http = () => request(serverOf(app));
  const signIn = (body: object, ip = testIp()) =>
    http().post('/api/auth/sign-in').set('X-Requested-With', 'tasnivo').set('X-Real-IP', ip).set('User-Agent', 'api-e2e').send(body);
  const me = (cookie?: string) => (cookie ? http().get('/api/auth/me').set('Cookie', cookie) : http().get('/api/auth/me'));

  before(async () => { app = await startApp(); });
  after(async () => {
    await app.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('GET /api/auth/me without a cookie, or with a garbage one, is 401', async () => {
    const none = await me();
    assert.equal(none.status, 401);
    assert.deepEqual(bodyOf(none), { error: { code: 'unauthorized', message: 'Sign in to continue.' } });
    assert.equal((await me(`${SESSION_COOKIE}=not-a-seal`)).status, 401);
  });

  it('signs in with the web app\'s cookie (same name, seal and options) and me returns the user', async () => {
    const u = await user();
    const res = await signIn({ email: `  ${u.email.toUpperCase()} `, password: u.password, next: '/catalogs?x=1' });
    assert.equal(res.status, 200, JSON.stringify(bodyOf(res)));
    assert.deepEqual(bodyOf<SignInResponse>(res), { ok: true, next: '/catalogs?x=1', twoFactor: false });

    const lines = setCookies(res);
    const line = lines.find((l) => l.startsWith(`${SESSION_COOKIE}=`)) ?? '';
    assert.match(line, /; Max-Age=604800/);
    assert.match(line, /; Path=\//);
    assert.match(line, /; HttpOnly/);
    assert.match(line, /; SameSite=Lax/);

    const pair = cookiePair(lines, SESSION_COOKIE)!;
    const data = await unsealPair(pair);
    assert.equal(data.userId, u.userId);
    assert.equal(data.orgId, u.orgId);
    assert.equal(data.email, u.email);
    assert.equal(data.demo, false);
    const record = await db.userSession.findUniqueOrThrow({ where: { id: data.sid! } });
    assert.equal(record.userId, u.userId);
    assert.equal(record.userAgent, 'api-e2e');
    assert.equal(record.revokedAt, null);

    const who = await me(pair);
    assert.equal(who.status, 200);
    const body = bodyOf<Me>(who);
    assert.deepEqual(body.user, { userId: u.userId, orgId: u.orgId, email: u.email, demo: false, clientId: null, role: 'admin', clientIds: null });
    assert.equal(body.org.id, u.orgId);
    assert.equal(body.org.kind, 'customer');
    assert.equal(body.role, 'admin');
    assert.equal(body.clientIds, null);
    assert.equal(body.locale, 'uz');
  });

  it('an unsafe next falls back to /dashboard; a saved interface language comes back as the locale cookie', async () => {
    const u = await user({ locale: 'ru' });
    const res = await signIn({ email: u.email, password: u.password, next: '//evil.example' });
    assert.equal(res.status, 200);
    assert.equal(bodyOf<SignInResponse>(res).next, '/dashboard');
    assert.equal(cookiePair(setCookies(res), 'mxik_locale'), 'mxik_locale=ru');
  });

  it('a wrong password is 401 with the sign-in form\'s message, in the request\'s language', async () => {
    const u = await user();
    const uz = await signIn({ email: u.email, password: 'wrong-password' });
    assert.equal(uz.status, 401);
    assert.equal(bodyOf(uz).error.code, 'invalid_credentials');
    assert.equal(setCookies(uz).length, 0);
    const ru = await http().post('/api/auth/sign-in').set('X-Requested-With', 'tasnivo').set('X-Real-IP', testIp())
      .set('Cookie', 'mxik_locale=ru').send({ email: 'nobody-at-all@test.local', password: 'x' });
    assert.equal(ru.status, 401);
    assert.notEqual(bodyOf(ru).error.message, bodyOf(uz).error.message);
    // A malformed address answers exactly like a wrong password.
    assert.deepEqual(bodyOf(await signIn({ email: 'not-an-email', password: 'x' })), bodyOf(uz));
  });

  it('after five wrong passwords for one address the sixth try is 429 with Retry-After, even with the right password', async () => {
    const u = await user();
    for (let i = 0; i < 5; i++) assert.equal((await signIn({ email: u.email, password: `wrong-${i}` })).status, 401);
    const limited = await signIn({ email: u.email, password: u.password });
    assert.equal(limited.status, 429);
    assert.equal(bodyOf(limited).error.code, 'rate_limited');
    const retry = Number(limited.headers['retry-after']);
    assert.ok(retry > 0 && retry <= 15 * 60, `Retry-After ${retry}`);
    assert.equal(setCookies(limited).length, 0);
  });

  it('a user with two-factor on gets the pending state: next /sign-in/2fa and no session yet', async () => {
    const u = await user({ twoFactor: true });
    const res = await signIn({ email: u.email, password: u.password });
    assert.equal(res.status, 200);
    assert.deepEqual(bodyOf<SignInResponse>(res), { ok: true, next: '/sign-in/2fa', twoFactor: true });
    const pair = cookiePair(setCookies(res), SESSION_COOKIE)!;
    const data = await unsealPair(pair);
    assert.equal(data.pendingUserId, u.userId);
    assert.equal(data.pendingVia, 'password');
    assert.equal(data.userId, undefined);
    assert.equal((await me(pair)).status, 401);
  });

  it('sign-out ends the session record and clears the cookie; the old cookie no longer works', async () => {
    const u = await user();
    const pair = cookiePair(setCookies(await signIn({ email: u.email, password: u.password })), SESSION_COOKIE)!;
    assert.equal((await me(pair)).status, 200);

    const out = await http().post('/api/auth/sign-out').set('X-Requested-With', 'tasnivo').set('Cookie', pair);
    assert.equal(out.status, 200);
    assert.deepEqual(bodyOf(out), { ok: true, next: '/sign-in' });
    const cleared = setCookies(out).find((l) => l.startsWith(`${SESSION_COOKIE}=`));
    assert.match(cleared ?? '', new RegExp(`^${SESSION_COOKIE}=;.*Max-Age=0`));
    const sessions = await db.userSession.findMany({ where: { userId: u.userId } });
    assert.ok(sessions.length === 1 && sessions[0]!.revokedAt !== null);
    assert.equal((await me(pair)).status, 401);

    // Without a session it still succeeds (and still clears).
    assert.equal((await http().post('/api/auth/sign-out').set('X-Requested-With', 'tasnivo')).status, 200);
  });

  it('a demo org past its end is rejected even with a live session record', async () => {
    const u = await user({ kind: 'demo', expiresAt: new Date(Date.now() - 60_000) });
    const sid = await createRecord(u.userId, u.orgId, 'api-e2e');
    const seal = await sealData({ userId: u.userId, orgId: u.orgId, email: u.email, demo: true, sid } satisfies SessionData, { password: sessionOptions.password });
    assert.equal((await me(`${SESSION_COOKIE}=${seal}`)).status, 401);
  });
});
