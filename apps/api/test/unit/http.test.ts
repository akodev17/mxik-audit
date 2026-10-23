// Config, error envelope, validation pipe and middleware: pure, no database.
import '../setup-env';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { i18nFor } from '@tasnivo/i18n/locale';
import { parseEnv, InvalidEnvError } from '../../src/config/env';
import { ApiError } from '../../src/http/errors';
import { requestOrigin } from '../../src/http/facts';
import { toErrorResponse } from '../../src/http/exception.filter';
import { loggablePath, requestLogMiddleware, securityHeadersMiddleware, type LogLine } from '../../src/http/middleware';
import type { ApiRequest } from '../../src/http/request';
import { ZodValidationPipe } from '../../src/http/zod-validation.pipe';
import { fakeReq, fakeRes } from '../helpers';

const SECRET = 's'.repeat(32);
const base = { DATABASE_URL: 'postgresql://x@localhost/db', SESSION_SECRET: SECRET };

describe('parseEnv', () => {
  it('fails fast on a SESSION_SECRET shorter than 32 characters, or none', () => {
    assert.throws(() => parseEnv({ ...base, SESSION_SECRET: 'short' }), (e: unknown) => e instanceof InvalidEnvError && /SESSION_SECRET: .*at least 32/.test(e.message));
    assert.throws(() => parseEnv({ DATABASE_URL: base.DATABASE_URL }), /SESSION_SECRET/);
    assert.throws(() => parseEnv({ SESSION_SECRET: SECRET }), /DATABASE_URL/);
  });

  it('defaults the port to 4000 and reads API_PORT, NEXT_PUBLIC_SITE_URL\'s origin and CRON_SECRET', () => {
    const plain = parseEnv(base);
    assert.equal(plain.port, 4000);
    assert.equal(plain.siteOrigin, null);
    assert.equal(plain.cronSecret, null);
    assert.equal(plain.production, false);
    const full = parseEnv({ ...base, API_PORT: '4100', NEXT_PUBLIC_SITE_URL: 'https://tasnivo.uz/some/path', CRON_SECRET: '  c'.padEnd(20, 'x'), NODE_ENV: 'production' });
    assert.equal(full.port, 4100);
    assert.equal(full.siteOrigin, 'https://tasnivo.uz');
    assert.equal(full.cronSecret, 'c'.padEnd(18, 'x'));
    assert.equal(full.production, true);
  });

  it('treats an empty assignment as unset, and names a bad port', () => {
    assert.equal(parseEnv({ ...base, API_PORT: '', NEXT_PUBLIC_SITE_URL: '' }).port, 4000);
    assert.throws(() => parseEnv({ ...base, API_PORT: 'eighty' }), /API_PORT/);
    assert.throws(() => parseEnv({ ...base, NEXT_PUBLIC_SITE_URL: 'tasnivo.uz' }), /NEXT_PUBLIC_SITE_URL/);
  });
});

describe('error envelope', () => {
  it('first-party: { error: { code, message } } plus the thrower\'s extra fields and headers', () => {
    const out = toErrorResponse(new ApiError(403, 'unverified', 'Confirm your address.', { 'X-A': '1' }, { unverified: true }), false);
    assert.deepEqual(out, { status: 403, headers: { 'X-A': '1' }, body: { error: { code: 'unverified', message: 'Confirm your address.' }, unverified: true } });
  });

  it('first-party: Nest\'s own exceptions get a code from their status', () => {
    assert.deepEqual(toErrorResponse(new NotFoundException('Cannot GET /api/x'), false).body, { error: { code: 'not_found', message: 'Cannot GET /api/x' } });
    assert.deepEqual(toErrorResponse(new BadRequestException(['a', 'b']), false).body, { error: { code: 'invalid_request', message: 'a; b' } });
  });

  it('keeps the status of body-parser\'s client errors (413, 415, 400) instead of a 500', () => {
    // http-errors as raw-body throws them: status plus expose: true.
    const tooLarge = Object.assign(new Error('request entity too large'), { status: 413, statusCode: 413, expose: true, type: 'entity.too.large' });
    assert.deepEqual(toErrorResponse(tooLarge, false), { status: 413, headers: {}, body: { error: { code: 'too_large', message: 'request entity too large' } } });
    assert.deepEqual(toErrorResponse(tooLarge, true).body.error, { code: 'too_large', message: 'request entity too large' });
    const charset = Object.assign(new Error('unsupported charset "UTF-7"'), { status: 415, expose: true });
    assert.equal(toErrorResponse(charset, false).status, 415);
    // Not marked safe to show, or a server status: still the generic 500.
    assert.equal(toErrorResponse(Object.assign(new Error('secret'), { status: 413 }), false).status, 500);
    assert.deepEqual(toErrorResponse(Object.assign(new Error('secret'), { status: 502, expose: true }), false).body,
      { error: { code: 'server_error', message: 'The request could not be completed. Try again later.' } });
  });

  it('first-party: generic refusals (401, 404, 413, CSRF) leave in the request\'s language; other messages as thrown', () => {
    for (const locale of ['uz', 'ru'] as const) {
      const h = i18nFor(locale).ta.httpX;
      const say = (e: unknown) => toErrorResponse(e, false, locale).body;
      assert.deepEqual(say(new ApiError(401, 'unauthorized', 'Sign in to continue.')), { error: { code: 'unauthorized', message: h.unauthorized } });
      assert.deepEqual(say(new ApiError(404, 'not_found', 'Not found.')), { error: { code: 'not_found', message: h.notFound } });
      assert.deepEqual(say(new ApiError(404, 'not_found', 'Client not found.')), { error: { code: 'not_found', message: h.notFound } });
      assert.deepEqual(say(new NotFoundException('Cannot GET /api/x')), { error: { code: 'not_found', message: h.notFound } });
      assert.deepEqual(say(Object.assign(new Error('request entity too large'), { status: 413, expose: true })), { error: { code: 'too_large', message: h.tooLarge } });
      assert.deepEqual(say(new ApiError(403, 'csrf', 'Cross-origin request refused.')), { error: { code: 'csrf', message: h.csrf } });
      // Already worded by the thrower (in the reader's language): untouched, extra fields kept.
      assert.deepEqual(say(new ApiError(404, 'not_found', 'Katalog topilmadi', {}, { x: 1 })), { error: { code: 'not_found', message: 'Katalog topilmadi' }, x: 1 });
      assert.deepEqual(say(new BadRequestException('Validation failed')), { error: { code: 'invalid_request', message: 'Validation failed' } });
    }
    // The public API keeps its English contract.
    assert.deepEqual(toErrorResponse(new ApiError(404, 'not_found', 'Not found.'), true, 'ru').body, { error: { code: 'not_found', message: 'Not found.' } });
  });

  it('never leaks an unexpected error\'s message', () => {
    const out = toErrorResponse(new Error('password=hunter2 in a stack'), false);
    assert.equal(out.status, 500);
    assert.deepEqual(out.body, { error: { code: 'server_error', message: 'The request could not be completed. Try again later.' } });
  });

  it('/api/v1: only documented codes, no extra fields (contract.ts)', () => {
    assert.deepEqual(toErrorResponse(ApiError.v1('rate_limited', 'slow down', { 'Retry-After': '3' }), true),
      { status: 429, headers: { 'Retry-After': '3' }, body: { error: { code: 'rate_limited', message: 'slow down' } } });
    // A first-party code on a v1 route falls back to the documented code for its status.
    assert.deepEqual(toErrorResponse(new ApiError(403, 'csrf', 'no', {}, { x: 1 }), true).body, { error: { code: 'invalid_request', message: 'no' } });
    assert.deepEqual(toErrorResponse(new NotFoundException(), true).body.error, { code: 'not_found', message: 'Not Found' });
    assert.deepEqual(toErrorResponse(new Error('boom'), true).body.error, { code: 'server_error', message: 'The request could not be completed. Try again later.' });
  });
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ email: z.string(), n: z.number().default(1) }));

  it('returns the parsed value (defaults applied, unknown keys stripped)', () => {
    assert.deepEqual(pipe.transform({ email: 'a', extra: true }), { email: 'a', n: 1 });
  });

  it('answers 400 invalid_request with the issues', () => {
    try {
      pipe.transform({ email: 5 });
      assert.fail('expected a 400');
    } catch (error) {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'invalid_request');
      assert.deepEqual(error.extra, { issues: [{ path: 'email', message: 'Expected string, received number' }] });
    }
  });
});

describe('middleware', () => {
  it('sets the web app\'s security headers and no-store; HSTS only in production', () => {
    const res = fakeRes();
    securityHeadersMiddleware({ NODE_ENV: 'development' })(fakeReq() as never, res as never, () => undefined);
    assert.match(String(res.headers['content-security-policy']), /frame-ancestors 'none'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['strict-transport-security'], undefined);
    const prod = fakeRes();
    securityHeadersMiddleware({ NODE_ENV: 'production' })(fakeReq() as never, prod as never, () => undefined);
    assert.equal(prod.headers['strict-transport-security'], 'max-age=31536000');
  });

  it('logs method, path without the query, status, duration and the user once finished', () => {
    const lines: LogLine[] = [];
    const listeners: (() => void)[] = [];
    const req = { ...fakeReq({ method: 'POST', path: '/api/auth/sign-in' }), originalUrl: '/api/auth/sign-in?token=secret', user: { userId: 'u9' } };
    const res = { statusCode: 401, on: (_event: string, fn: () => void) => listeners.push(fn) };
    requestLogMiddleware((line) => lines.push(line))(req as never, res as never, () => undefined);
    listeners.forEach((fn) => fn());
    assert.equal(lines.length, 1);
    const [line] = lines;
    assert.deepEqual({ ...line, ms: 0 }, { method: 'POST', path: '/api/auth/sign-in', status: 401, ms: 0, userId: 'u9' });
  });

  it('never logs a secret path segment: reset, verification, invite, demo and share tokens, one-time states', () => {
    const secret = 'Zx9-SECRET_token_43chars_aaaaaaaaaaaaaaaaaaa';
    const cases: [string, string][] = [
      [`/api/auth/password/reset/${secret}`, '/api/auth/password/reset/{token}'],
      [`/api/auth/verify/${secret}`, '/api/auth/verify/{token}'],
      [`/api/invites/${secret}/join`, '/api/invites/{token}/join'],
      [`/api/invites/${secret}`, '/api/invites/{token}'],
      [`/api/demo/links/${secret}`, '/api/demo/links/{token}'],
      [`/api/share/${secret}/pdf`, '/api/share/{token}/pdf'],
      [`/API/Share/${secret}`, '/api/share/{token}'],
      [`/api/auth/telegram/bind/${secret}`, '/api/auth/telegram/bind/{state}'],
    ];
    for (const [path, logged] of cases) {
      assert.equal(loggablePath(path), logged);
      const lines: LogLine[] = [];
      const listeners: (() => void)[] = [];
      requestLogMiddleware((line) => lines.push(line))({ ...fakeReq({ method: 'GET', path }), originalUrl: `${path}?x=1` } as never,
        { statusCode: 200, on: (_e: string, fn: () => void) => listeners.push(fn) } as never, () => undefined);
      listeners.forEach((fn) => fn());
      assert.equal(lines[0]?.path, logged);
      assert.ok(!JSON.stringify(lines).includes(secret));
    }
    // Ordinary ids stay: they are what an operator looks for.
    assert.equal(loggablePath('/api/catalogs/cm123/rows'), '/api/catalogs/cm123/rows');
    assert.equal(loggablePath('/api/auth/telegram/bind'), '/api/auth/telegram/bind');
  });
});

describe('requestOrigin (OAuth redirect URI fallback while APP_URL is unset)', () => {
  const origin = (headers: Record<string, string>) => requestOrigin(fakeReq({ headers }) as unknown as ApiRequest);

  it('prefers the proxy\'s forwarded host and protocol, else Host', () => {
    assert.equal(origin({ host: 'localhost:4011', 'x-forwarded-host': 'agent1.localhost:3011', 'x-forwarded-proto': 'http' }), 'http://agent1.localhost:3011');
    assert.equal(origin({ host: 'api:4000', 'x-forwarded-host': 'tasnivo.uz, caddy', 'x-forwarded-proto': 'https' }), 'https://tasnivo.uz');
    assert.equal(origin({ host: 'localhost:3011' }), 'http://localhost:3011');
  });

  it('refuses a host that is not a plain name with an optional port', () => {
    assert.equal(origin({ host: 'evil.example/path' }), null);
    assert.equal(origin({ host: 'a@b' }), null);
    assert.equal(origin({}), null);
  });
});
