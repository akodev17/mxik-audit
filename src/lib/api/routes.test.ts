// The /api/v1 handlers called directly with real keys against the development database:
// rate-limit headers on success, scoping to the key's org, and the documented error envelope.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { GET as reportRoute } from '@/app/api/v1/catalogs/[id]/report/route';
import { GET as listRoute, POST as uploadRoute } from '@/app/api/v1/catalogs/route';
import { POST as checkRoute } from '@/app/api/v1/check/route';
import { db } from '../db.js';
import { dbSkipReason, dropOrgs, makeCatalog, makeOrg, type TestActor } from '../test-fixtures.js';
import { HEADERS, OPERATIONS, type OperationId } from './contract.js';
import { createApiKey } from './keys.js';
import { openApiSpec } from './openapi.js';

const skip = await dbSkipReason();
const BASE = 'http://localhost/api/v1';
type Json = Record<string, unknown>;

const spec = openApiSpec('http://localhost') as unknown as { components: { schemas: Record<string, { properties: Json }> } };
const props = (name: string): string[] => Object.keys(spec.components.schemas[name]?.properties ?? {}).sort();

function call(token: string | null, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request(`${BASE}${path}`, { ...init, headers });
}

async function body(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

/** The error is one this operation documents, in the documented envelope. */
async function documentedError(op: OperationId, response: Response, code: string): Promise<void> {
  const json = await body(response);
  assert.deepEqual(Object.keys(json), ['error']);
  const error = json['error'] as Json;
  assert.equal(error['code'], code);
  assert.equal(typeof error['message'], 'string');
  assert.ok((OPERATIONS[op].errors as readonly string[]).includes(code), `${op} documents ${code}`);
}

function hasRateHeaders(response: Response): void {
  assert.match(response.headers.get(HEADERS.limit) ?? '', /^\d+$/);
  assert.match(response.headers.get(HEADERS.remaining) ?? '', /^\d+$/);
}

describe('/api/v1 handlers (database)', { skip }, () => {
  let a: TestActor;
  let b: TestActor;
  let tokenA = '';
  let tokenB = '';
  let catalogA = '';
  let catalogB = '';
  const ownCatalogs: string[] = [];

  before(async () => {
    a = await makeOrg();
    b = await makeOrg();
    tokenA = (await createApiKey(a, 'test'))?.token ?? '';
    tokenB = (await createApiKey(b, 'test'))?.token ?? '';
    for (let i = 0; i < 3; i++) ownCatalogs.push((await makeCatalog(a.orgId, [{ rawName: `Tovar ${i}`, suggestedMxik: null, confidence: null }])).catalogId);
    catalogA = ownCatalogs[0] ?? '';
    catalogB = (await makeCatalog(b.orgId, [{ rawName: 'Boshqa', suggestedMxik: null, confidence: null }])).catalogId;
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  it('without a key: 401 in the envelope, and no per-key rate headers', async () => {
    const response = await listRoute(call(null, '/catalogs'));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get(HEADERS.limit), null);
    await documentedError('listCatalogs', response, 'unauthorized');
  });

  it('a 200 carries X-RateLimit-Limit and X-RateLimit-Remaining', async () => {
    const response = await listRoute(call(tokenA, '/catalogs'));
    assert.equal(response.status, 200);
    hasRateHeaders(response);
  });

  it('lists only the key\'s own catalogues, in the documented shape', async () => {
    const json = await body(await listRoute(call(tokenA, '/catalogs?limit=100')));
    const ids = (json['catalogs'] as Json[]).map((c) => c['id']);
    assert.deepEqual(new Set(ids), new Set(ownCatalogs));
    assert.ok(!ids.includes(catalogB));
    assert.deepEqual(Object.keys(json).sort(), props('CatalogList'));
    assert.deepEqual(Object.keys((json['catalogs'] as Json[])[0] ?? {}).sort(), props('Catalog'));
  });

  it('pages with limit and nextCursor until the last page', async () => {
    const seen: unknown[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const json = await body(await listRoute(call(tokenA, `/catalogs?limit=2${cursor ? `&cursor=${cursor}` : ''}`)));
      seen.push(...(json['catalogs'] as Json[]).map((c) => c['id']));
      cursor = json['nextCursor'] as string | null;
      if (!cursor) break;
    }
    assert.deepEqual(new Set(seen), new Set(ownCatalogs));
    assert.equal(seen.length, ownCatalogs.length);
  });

  it('another org\'s catalogue is neither a valid cursor nor a client filter', async () => {
    const badCursor = await listRoute(call(tokenA, `/catalogs?cursor=${catalogB}`));
    assert.equal(badCursor.status, 400);
    hasRateHeaders(badCursor);
    await documentedError('listCatalogs', badCursor, 'invalid_request');
    const foreignClient = await db.catalog.findUniqueOrThrow({ where: { id: catalogB }, select: { clientId: true } });
    const filtered = await listRoute(call(tokenA, `/catalogs?clientId=${foreignClient.clientId}`));
    assert.equal(filtered.status, 404);
    await documentedError('listCatalogs', filtered, 'not_found');
  });

  it('the report of another org\'s catalogue is 404; its own is 200 in the documented shape', async () => {
    const foreign = await reportRoute(call(tokenA, `/catalogs/${catalogB}/report`), { params: Promise.resolve({ id: catalogB }) });
    assert.equal(foreign.status, 404);
    hasRateHeaders(foreign);
    await documentedError('report', foreign, 'not_found');

    const own = await reportRoute(call(tokenA, `/catalogs/${catalogA}/report`), { params: Promise.resolve({ id: catalogA }) });
    assert.equal(own.status, 200);
    hasRateHeaders(own);
    const json = await body(own);
    assert.deepEqual(Object.keys(json).sort(), props('Report'));
    assert.deepEqual(Object.keys((json['findings'] as Json[])[0] ?? {}).sort(), props('Finding'));
  });

  it('the other org\'s key sees only its own catalogue', async () => {
    const json = await body(await listRoute(call(tokenB, '/catalogs')));
    assert.deepEqual((json['catalogs'] as Json[]).map((c) => c['id']), [catalogB]);
  });

  it('check: a bad body and a bad Idempotency-Key are documented 400s with rate headers', async () => {
    const bad = await checkRoute(call(tokenA, '/check', { method: 'POST', body: JSON.stringify({ nom: 'x' }), headers: { 'content-type': 'application/json' } }));
    assert.equal(bad.status, 400);
    hasRateHeaders(bad);
    await documentedError('check', bad, 'invalid_request');
    const key = await checkRoute(call(tokenA, '/check', { method: 'POST', body: JSON.stringify({ name: 'Sut' }), headers: { 'content-type': 'application/json', 'idempotency-key': 'has space' } }));
    assert.equal(key.status, 400);
    await documentedError('check', key, 'invalid_request');
  });

  it('upload: a missing file is a documented 400', async () => {
    const response = await uploadRoute(call(tokenA, '/catalogs', { method: 'POST', body: new FormData() }));
    assert.equal(response.status, 400);
    hasRateHeaders(response);
    await documentedError('uploadCatalog', response, 'invalid_request');
  });
});
