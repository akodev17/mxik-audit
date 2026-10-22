// Guards with fake requests and stubbed domain functions: no database, no HTTP server.
import '../setup-env';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Reflector } from '@nestjs/core';
import type { ApiCaller } from '@tasnivo/domain/api/keys';
import type { RateResult } from '@tasnivo/domain/api/limits';
import type { Access } from '@tasnivo/domain/session';
import { ApiKeyGuard, type Authenticate } from '../../src/auth-core/api-key.guard';
import { bearerMatches, CronGuard } from '../../src/auth-core/cron.guard';
import { CsrfGuard } from '../../src/auth-core/csrf.guard';
import type { RateLimitStore } from '../../src/auth-core/rate-limit.store';
import { OptionalSessionGuard, SessionGuard } from '../../src/auth-core/session.guard';
import { SESSION_COOKIE, SessionService, type SessionDeps } from '../../src/auth-core/session.service';
import { SkipCsrf } from '../../src/http/decorators';
import { ApiError } from '../../src/http/errors';
import { fakeReq, fakeRes, httpContext, testConfig } from '../helpers';

async function rejects(promise: Promise<unknown> | (() => unknown), status: number, code: string): Promise<ApiError> {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    assert.ok(error instanceof ApiError, `expected ApiError, got ${String(error)}`);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected ${status} ${code}`);
}

describe('SessionGuard', () => {
  const access: Access = { role: 'accountant', clientIds: ['c1'], demoOrg: false };
  const calls: string[] = [];
  const deps = (over: Partial<SessionDeps> = {}): SessionDeps => ({
    loadAccess: (userId, orgId) => { calls.push(`access ${userId} ${orgId}`); return Promise.resolve(access); },
    recordAccepted: (sid, userId, demo) => { calls.push(`record ${sid} ${userId} ${demo}`); return Promise.resolve(true); },
    ...over,
  });
  const service = (over: Partial<SessionDeps> = {}) => new SessionService(testConfig(), deps(over));
  const signedIn = { userId: 'u1', orgId: 'o1', email: 'a@test.local', sid: 's1', clientId: 'c1', demo: false };

  async function reqWith(data: object | null, svc = service()) {
    return fakeReq({ headers: data ? { cookie: `${SESSION_COOKIE}=${await svc.seal(data)}` } : {} });
  }

  it('puts a CurrentUser on the request: cookie fields plus role and client scope from the database', async () => {
    calls.length = 0;
    const svc = service();
    const req = await reqWith(signedIn, svc);
    assert.equal(await new SessionGuard(svc).canActivate(httpContext(req)), true);
    assert.deepEqual(req['user'], { userId: 'u1', orgId: 'o1', email: 'a@test.local', demo: false, clientId: 'c1', role: 'accountant', clientIds: ['c1'] });
    assert.deepEqual(calls, ['access u1 o1', 'record s1 u1 false']);
  });

  it('answers 401 without a cookie, with a tampered one, or with one sealed under another secret', async () => {
    await rejects(new SessionGuard(service()).canActivate(httpContext(await reqWith(null))), 401, 'unauthorized');
    const tampered = fakeReq({ headers: { cookie: `${SESSION_COOKIE}=Fe26.2*1*garbage~2` } });
    await rejects(new SessionGuard(service()).canActivate(httpContext(tampered)), 401, 'unauthorized');
    const { sealData } = await import('iron-session');
    const foreign = await sealData(signedIn, { password: 'another-secret-another-secret-0123456789' });
    await rejects(new SessionGuard(service()).canActivate(httpContext(fakeReq({ headers: { cookie: `${SESSION_COOKIE}=${foreign}` } }))), 401, 'unauthorized');
  });

  it('answers 401 when loadAccess refuses (removed user, expired demo org)', async () => {
    const svc = service({ loadAccess: () => Promise.resolve(null) });
    await rejects(new SessionGuard(svc).canActivate(httpContext(await reqWith(signedIn, svc))), 401, 'unauthorized');
  });

  it('answers 401 when the session record is revoked or idle, and passes demoOrg to the idle check', async () => {
    let demoSeen: boolean | null = null;
    const svc = service({
      loadAccess: () => Promise.resolve({ role: 'admin', clientIds: null, demoOrg: true }),
      recordAccepted: (_sid, _user, demo) => { demoSeen = demo; return Promise.resolve(false); },
    });
    await rejects(new SessionGuard(svc).canActivate(httpContext(await reqWith(signedIn, svc))), 401, 'unauthorized');
    assert.equal(demoSeen, true);
  });

  it('a pending two-factor cookie (no userId) is not signed in', async () => {
    const svc = service();
    await rejects(new SessionGuard(svc).canActivate(httpContext(await reqWith({ pendingUserId: 'u1', pendingAt: Date.now() }, svc))), 401, 'unauthorized');
  });

  it('OptionalSessionGuard lets everyone through with req.user = user or null', async () => {
    const svc = service();
    const anonymous = await reqWith(null, svc);
    assert.equal(await new OptionalSessionGuard(svc).canActivate(httpContext(anonymous)), true);
    assert.equal(anonymous['user'], null);
    const known = await reqWith(signedIn, svc);
    await new OptionalSessionGuard(svc).canActivate(httpContext(known));
    assert.equal((known['user'] as { userId: string }).userId, 'u1');
  });

  it('refuses to start when SESSION_SECRET was read before the .env was loaded', () => {
    assert.throws(() => new SessionService(testConfig({ sessionSecret: 'x'.repeat(40) }), deps()), /SESSION_SECRET was read before/);
  });
});

describe('ApiKeyGuard', () => {
  const caller: ApiCaller = { keyId: 'k1', orgId: 'o1' };
  const store = (result: Partial<RateResult> = {}): RateLimitStore & { keys: string[] } => {
    const keys: string[] = [];
    return { keys, take: (keyId) => { keys.push(keyId); return Promise.resolve({ ok: true, limit: 60, remaining: 59, retryAfter: 0, ...result }); } };
  };
  const auth = (answer: ApiCaller | null, seen: (string | null)[] = []): Authenticate => (header) => { seen.push(header); return Promise.resolve(answer); };

  it('authenticates the bearer key, takes one from its budget and sets the rate-limit headers', async () => {
    const seen: (string | null)[] = [];
    const rates = store();
    const req = fakeReq({ path: '/api/v1/catalogs', headers: { authorization: 'Bearer mxk_abc' } });
    const res = fakeRes();
    assert.equal(await new ApiKeyGuard(auth(caller, seen), rates).canActivate(httpContext(req, res)), true);
    assert.deepEqual(seen, ['Bearer mxk_abc']);
    assert.deepEqual(rates.keys, ['k1']);
    assert.deepEqual(req['apiCaller'], caller);
    assert.equal(res.headers['x-ratelimit-limit'], '60');
    assert.equal(res.headers['x-ratelimit-remaining'], '59');
  });

  it('answers the documented 401 envelope without a valid key, and touches no budget', async () => {
    const rates = store();
    const error = await rejects(new ApiKeyGuard(auth(null), rates).canActivate(httpContext(fakeReq({ path: '/api/v1/check' }))), 401, 'unauthorized');
    assert.match(error.message, /Authorization: Bearer <key>/);
    assert.deepEqual(rates.keys, []);
  });

  it('answers 429 rate_limited with Retry-After and the rate-limit headers when the budget is spent', async () => {
    const res = fakeRes();
    const error = await rejects(
      new ApiKeyGuard(auth(caller), store({ ok: false, remaining: 0, retryAfter: 17 })).canActivate(httpContext(fakeReq({ path: '/api/v1/check' }), res)),
      429, 'rate_limited');
    assert.deepEqual(error.headers, { 'Retry-After': '17' });
    assert.equal(res.headers['x-ratelimit-remaining'], '0');
    assert.match(error.message, /at most 60 per minute/);
  });
});

describe('CronGuard', () => {
  const secret = 'cron-secret-0123456789';
  const guard = (cronSecret: string | null) => new CronGuard(testConfig({ cronSecret }));
  const ctx = (authorization?: string) => httpContext(fakeReq({ method: 'POST', headers: authorization ? { authorization } : {} }));

  it('answers 503 while CRON_SECRET is unset or shorter than 16 characters', async () => {
    await rejects(() => guard(null).canActivate(ctx(`Bearer ${secret}`)), 503, 'cron_disabled');
    await rejects(() => guard('short-secret').canActivate(ctx('Bearer short-secret')), 503, 'cron_disabled');
  });

  it('answers 401 for a missing or wrong bearer token, and lets the right one through', async () => {
    await rejects(() => guard(secret).canActivate(ctx()), 401, 'unauthorized');
    await rejects(() => guard(secret).canActivate(ctx(`Bearer ${secret}x`)), 401, 'unauthorized');
    await rejects(() => guard(secret).canActivate(ctx('Bearer cron-secret-0123456788')), 401, 'unauthorized');
    assert.equal(guard(secret).canActivate(ctx(`Bearer ${secret}`)), true);
    assert.equal(guard(secret).canActivate(ctx(`bearer ${secret}`)), true);
  });

  it('compares only equal lengths (timingSafeEqual would throw otherwise)', () => {
    assert.equal(bearerMatches(null, secret), false);
    assert.equal(bearerMatches('Bearer ', secret), false);
    assert.equal(bearerMatches(secret, secret), true);
  });
});

describe('CsrfGuard', () => {
  const site = 'https://tasnivo.uz';
  const guard = (siteOrigin: string | null = site) => new CsrfGuard(new Reflector(), testConfig({ siteOrigin }));
  const post = (headers: Record<string, string>, path = '/api/auth/sign-in') => httpContext(fakeReq({ method: 'POST', path, headers }));

  it('lets safe methods through untouched', () => {
    assert.equal(guard().canActivate(httpContext(fakeReq({ method: 'GET' }))), true);
    assert.equal(guard().canActivate(httpContext(fakeReq({ method: 'HEAD' }))), true);
  });

  it('requires X-Requested-With: tasnivo on a mutating first-party request', async () => {
    await rejects(() => guard().canActivate(post({})), 403, 'csrf');
    await rejects(() => guard().canActivate(post({ 'x-requested-with': 'XMLHttpRequest' })), 403, 'csrf');
    assert.equal(guard().canActivate(post({ 'x-requested-with': 'tasnivo' })), true);
  });

  it('refuses an Origin other than NEXT_PUBLIC_SITE_URL\'s, accepts it or none', async () => {
    await rejects(() => guard().canActivate(post({ 'x-requested-with': 'tasnivo', origin: 'https://evil.example' })), 403, 'csrf');
    await rejects(() => guard().canActivate(post({ 'x-requested-with': 'tasnivo', origin: 'https://tasnivo.uz.evil.example' })), 403, 'csrf');
    assert.equal(guard().canActivate(post({ 'x-requested-with': 'tasnivo', origin: site })), true);
    assert.equal(guard(null).canActivate(post({ 'x-requested-with': 'tasnivo', origin: 'http://localhost:3000' })), true);
  });

  it('skips /api/v1 and routes marked @SkipCsrf()', () => {
    assert.equal(guard().canActivate(post({}, '/api/v1/check')), true);
    // On a whole controller (provider callbacks) …
    @SkipCsrf()
    class Callbacks {}
    const onClass = httpContext(fakeReq({ method: 'POST', path: '/api/payments/click' }), fakeRes(), () => undefined, Callbacks);
    assert.equal(guard().canActivate(onClass), true);
    // … or on one handler.
    class Cron {
      @SkipCsrf()
      run(): void {}
    }
    const run = Object.getOwnPropertyDescriptor(Cron.prototype, 'run')!.value as () => void;
    assert.equal(guard().canActivate(httpContext(fakeReq({ method: 'POST', path: '/api/cron/daily' }), fakeRes(), run, Cron)), true);
  });
});
