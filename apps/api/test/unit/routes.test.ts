// Route() wiring and the W2a modules' coverage of the registry: every operation of endpoints.auth,
// endpoints.account and endpoints.team has a handler at its path, documented from its schemas.
// Builds the app in memory; no database needed (nothing is queried).
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { lastValueFrom, of } from 'rxjs';
import { endpoints, expressPath, type Endpoint } from '@tasnivo/contracts';
import { theme as webPrefs } from './web-prefs';
import { PREF_COOKIE_OPTIONS, SIDEBAR_COOKIE, THEME_COOKIE } from '../../src/account/prefs';
import { queryPairs } from '../../src/http/facts';
import { JsonAnswerInterceptor } from '../../src/http/json-answer.interceptor';
import type { ApiRequest } from '../../src/http/request';
import { startApp } from '../helpers';

const MODULES = ['auth', 'account', 'team'] as const;
const mine = MODULES.flatMap((m) => Object.values(endpoints[m] as Record<string, Endpoint>));

describe('W2a routes in the Swagger document', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  before(async () => {
    app = await startApp();
    doc = SwaggerModule.createDocument(app, { openapi: '3.0.0', info: { title: 't', version: '0' } });
  });
  after(() => app.close());

  it('has one operation per registry entry, at its method and path, with its operation id', () => {
    // 53, plus the code step (verifyCode, resendCode), Google sign-in (google, googleCallback), the tour flag (setTour), the module states (modules) and the removal check (team.removalCheck).
    assert.equal(mine.length, 60);
    for (const e of mine) {
      const path = expressPath(e.path).replace(/:(\w+)/g, '{$1}');
      const op = doc.paths[path]?.[e.method.toLowerCase() as 'get'];
      assert.ok(op, `${e.operationId}: no ${e.method} ${path}`);
      assert.equal(op.operationId, e.operationId);
      assert.deepEqual(op.tags, [e.module]);
      assert.equal((op as unknown as Record<string, unknown>)['x-auth'], e.auth);
    }
  });

  it('documents bodies, path parameters, the CSRF header and the answers from the zod schemas', () => {
    const signIn = doc.paths['/api/auth/sign-in']!.post!;
    const body = (signIn.requestBody as { content: Record<string, { schema: { properties: Record<string, unknown>; required: string[] } }> }).content['application/json']!.schema;
    assert.deepEqual(Object.keys(body.properties), ['email', 'password', 'next']);
    assert.deepEqual(body.required, ['email', 'password']);
    assert.ok(signIn.parameters?.some((p) => 'name' in p && p.name === 'X-Requested-With'));
    assert.ok(signIn.responses['200'] && signIn.responses['default']);

    const remove = doc.paths['/api/team/members/{userId}']!.delete!;
    assert.ok(remove.parameters?.some((p) => 'in' in p && p.in === 'path' && p.name === 'userId'));
    assert.deepEqual(remove.security, [{ session: [] }]);

    const branding = doc.paths['/api/account/branding']!.post!.requestBody as { content: Record<string, { schema: { properties: Record<string, unknown> } }> };
    assert.deepEqual(Object.keys(branding.content['multipart/form-data']!.schema.properties).sort(), ['brandName', 'logo', 'removeLogo']);
    assert.ok(doc.paths['/api/auth/verify/{token}']!.get!.responses['307']);
    assert.ok(doc.paths['/api/account/export']!.get!.responses['200']);
  });
});

describe('preference cookies', () => {
  it('use the web app\'s names and options', () => {
    assert.equal(THEME_COOKIE, webPrefs.THEME_COOKIE);
    assert.equal(SIDEBAR_COOKIE, webPrefs.SIDEBAR_COOKIE);
    assert.deepEqual(PREF_COOKIE_OPTIONS, webPrefs.PREF_COOKIE_OPTIONS);
  });
});

describe('JsonAnswerInterceptor', () => {
  const run = async (value: unknown): Promise<string> => {
    const out = await lastValueFrom(new JsonAnswerInterceptor().intercept(undefined, { handle: () => of(value) }));
    return JSON.stringify(out);
  };
  it('lets objects through and makes primitives and null serialise as JSON', async () => {
    assert.equal(await run({ ok: true }), '{"ok":true}');
    assert.equal(await run(null), 'null');
    assert.equal(await run(undefined), 'null');
    assert.equal(await run(true), 'true');
    assert.equal(await run(3), '3');
    assert.equal(await run('state'), '"state"');
  });
});

describe('queryPairs', () => {
  it('reads the query string like URLSearchParams: one string per key, the last one winning, no nesting', () => {
    const req = { originalUrl: '/api/auth/telegram?id=1&a[b]=2&id=3&hash=x%20y' } as ApiRequest;
    assert.deepEqual(queryPairs(req), { id: '3', 'a[b]': '2', hash: 'x y' });
  });
});
