// The registry-driven route helpers: paths, Swagger schemas, JSON scalars, payload merging, the role guard.
import '../setup-env';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { endpoints } from '@tasnivo/contracts';
import { ROLE_KEY, RoleGuard } from '../../src/auth-core/role.guard';
import { JsonAnswerInterceptor, routePath, swaggerSchema } from '../../src/http/endpoint';
import { ApiError } from '../../src/http/errors';
import { found, withPath } from '../../src/http/payload';
import { fakeReq, httpContext } from '../helpers';

describe('routePath', () => {
  it('drops the global /api prefix and uses Express params', () => {
    assert.equal(routePath('/api/catalogs/{catalogId}/review/done'), 'catalogs/:catalogId/review/done');
    assert.equal(routePath('/api/export'), 'export');
    assert.throws(() => routePath('/r/{token}'), /starts with \/api\//);
  });
});

describe('swaggerSchema', () => {
  it('inlines the contracts\' named schemas, so Nest\'s document has no dangling $ref', () => {
    const json = JSON.stringify(swaggerSchema(endpoints.catalogs.previewUpload.response));
    assert.equal(json.includes('$ref'), false);
    assert.ok(json.includes('"catalogId"'));
  });
});

describe('JsonAnswerInterceptor', () => {
  it('sends null and booleans as JSON, leaves objects and arrays to Nest', async () => {
    const answer = async (value: unknown) => lastValueFrom(new JsonAnswerInterceptor().intercept(httpContext(fakeReq()), { handle: () => of(value) }));
    for (const value of [null, false, true, 3]) {
      const file = await answer(value) as { getStream(): NodeJS.ReadableStream; getHeaders(): { type?: string } };
      assert.equal(file.getHeaders().type, 'application/json; charset=utf-8');
      const chunks: Buffer[] = [];
      for await (const chunk of file.getStream()) chunks.push(Buffer.from(chunk as Buffer));
      assert.equal(Buffer.concat(chunks).toString(), JSON.stringify(value));
    }
    const object = { ok: true };
    assert.equal(await answer(object), object);
    const list: unknown[] = [];
    assert.equal(await answer(list), list);
  });
});

describe('payload helpers', () => {
  it('withPath merges the path ids over an object body and ignores anything else', () => {
    assert.deepEqual(withPath({ mapping: { name: 0 }, catalogId: 'body' }, { catalogId: 'path' }), { mapping: { name: 0 }, catalogId: 'path' });
    assert.deepEqual(withPath(null, { listId: 'l' }), { listId: 'l' });
    assert.deepEqual(withPath([1, 2], { listId: 'l' }), { listId: 'l' });
    assert.deepEqual(withPath('text', { listId: 'l' }), { listId: 'l' });
  });

  it('found answers 404 for null and undefined only', () => {
    assert.equal(found(0), 0);
    assert.throws(() => found(null), (e: unknown) => e instanceof ApiError && e.status === 404 && e.code === 'not_found');
    assert.throws(() => found(undefined), ApiError);
  });
});

describe('RoleGuard', () => {
  const user = (role: 'admin' | 'accountant' | 'viewer') => ({ userId: 'u', orgId: 'o', email: 'a@b', demo: false, clientId: null, clientIds: null, role });
  const check = async (role: string, who: ReturnType<typeof user> | undefined) => {
    const handler = () => undefined;
    Reflect.defineMetadata(ROLE_KEY, role, handler);
    const req = fakeReq({ method: 'POST' });
    req['user'] = who;
    return new RoleGuard(new Reflector()).canActivate(httpContext(req, undefined, handler));
  };
  const forbidden = (e: unknown) => e instanceof ApiError && e.status === 403 && e.code === 'forbidden';

  it('writer: admins and accountants; admin: admins only; any: everyone signed in', async () => {
    assert.equal(await check('writer', user('accountant')), true);
    assert.equal(await check('writer', user('admin')), true);
    await assert.rejects(check('writer', user('viewer')), forbidden);
    assert.equal(await check('admin', user('admin')), true);
    await assert.rejects(check('admin', user('accountant')), forbidden);
    assert.equal(await check('any', user('viewer')), true);
    await assert.rejects(check('any', undefined), (e: unknown) => e instanceof ApiError && e.status === 401);
  });
});
