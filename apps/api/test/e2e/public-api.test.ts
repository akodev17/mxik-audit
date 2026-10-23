// /api/v1 through the Nest app with real keys against the development database: the expectations
// of the web app's src/lib/api/routes.test.ts (rate-limit headers, org scoping, the documented
// envelope), the happy paths of check, list, upload and report, idempotency, 429, openapi.json,
// and answers byte-identical to the shared domain operations the web routes run.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildOpenApi } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { HEADERS, OPERATIONS, type OperationId } from '@tasnivo/domain/api/contract';
import { listCatalogsOperation, reportOperation } from '@tasnivo/domain/api/handlers';
import { authenticate, createApiKey } from '@tasnivo/domain/api/keys';
import { checksInFlight, startCheck } from '@tasnivo/domain/api/limits';
import { openApiSpec } from '@tasnivo/domain/api/openapi';
import { setJobs, type JobDispatcher } from '@tasnivo/domain/jobs/dispatcher';
import { dbSkipReason, dropOrgs, makeCatalog, makeOrg, type TestActor } from '@tasnivo/domain/test-fixtures';
import { serverOf, startApp } from '../helpers';
import { withEnv } from '../w2d-support';

const skip = await dbSkipReason();
type Json = Record<string, unknown>;

const spec = openApiSpec('http://localhost') as unknown as { components: { schemas: Record<string, { properties: Json }> } };
const props = (name: string): string[] => Object.keys(spec.components.schemas[name]?.properties ?? {}).sort();

type Res = { status: number; body: unknown; headers: Record<string, string | undefined>; text: string };

/** The error is one this operation documents, in the documented envelope. */
function documentedError(op: OperationId, res: Res, code: string): void {
  const json = res.body as Json;
  assert.deepEqual(Object.keys(json), ['error']);
  const error = json['error'] as Json;
  assert.equal(error['code'], code);
  assert.equal(typeof error['message'], 'string');
  assert.ok((OPERATIONS[op].errors as readonly string[]).includes(code), `${op} documents ${code}`);
}

function hasRateHeaders(res: Res): void {
  assert.match(res.headers[HEADERS.limit.toLowerCase()] ?? '', /^\d+$/);
  assert.match(res.headers[HEADERS.remaining.toLowerCase()] ?? '', /^\d+$/);
}

describe('/api/v1 through the Nest app (database)', { skip }, () => {
  let app: INestApplication;
  let a: TestActor;
  let b: TestActor;
  let tokenA = '';
  let tokenB = '';
  let catalogA = '';
  let catalogB = '';
  const ownCatalogs: string[] = [];
  const audits: string[] = [];
  const http = () => request(serverOf(app));
  const as = (token: string | null) => ({
    get: (path: string) => (token ? http().get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`) : http().get(`/api/v1${path}`)),
    post: (path: string) => (token ? http().post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`) : http().post(`/api/v1${path}`)),
  });

  before(async () => {
    app = await startApp();
    a = await makeOrg();
    b = await makeOrg();
    tokenA = (await createApiKey({ ...a, role: 'admin' }, 'test'))?.token ?? '';
    tokenB = (await createApiKey({ ...b, role: 'admin' }, 'test'))?.token ?? '';
    for (let i = 0; i < 3; i++) ownCatalogs.push((await makeCatalog(a.orgId, [{ rawName: `Tovar ${i}`, suggestedMxik: null, confidence: null }])).catalogId);
    catalogA = ownCatalogs[0] ?? '';
    catalogB = (await makeCatalog(b.orgId, [{ rawName: 'Boshqa', suggestedMxik: null, confidence: null }])).catalogId;
    // B12: an unconfirmed upload (draft) of A's is never listed.
    await db.catalog.create({ data: { orgId: a.orgId, filename: 'draft.xlsx', rowCount: 1, status: 'uploaded', headers: ['name'], columnMap: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1 } } });
    // Uploads queue their audit instead of running it in the test process.
    setJobs({ mode: 'bullmq', enqueueAudit: (catalogId: string) => { audits.push(catalogId); return Promise.resolve(); } } as unknown as JobDispatcher);
  });
  after(async () => {
    setJobs(null);
    await app.close();
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  it('without a key: 401 in the envelope, and no per-key rate headers', async () => {
    const res = await as(null).get('/catalogs');
    assert.equal(res.status, 401);
    assert.equal(res.headers[HEADERS.limit.toLowerCase()], undefined);
    documentedError('listCatalogs', res, 'unauthorized');
  });

  it('a 200 carries X-RateLimit-Limit and X-RateLimit-Remaining', async () => {
    const res = await as(tokenA).get('/catalogs');
    assert.equal(res.status, 200);
    hasRateHeaders(res);
  });

  it('lists only the key\'s own catalogues, in the documented shape, byte for byte the shared operation\'s answer', async () => {
    const res = await as(tokenA).get('/catalogs?limit=100');
    const json = res.body as Json;
    const ids = (json['catalogs'] as Json[]).map((c) => c['id']);
    assert.deepEqual(new Set(ids), new Set(ownCatalogs));
    assert.ok(!ids.includes(catalogB));
    assert.deepEqual(Object.keys(json).sort(), props('CatalogList'));
    assert.deepEqual(Object.keys((json['catalogs'] as Json[])[0] ?? {}).sort(), props('Catalog'));
    const caller = await authenticate(`Bearer ${tokenA}`);
    assert.ok(caller);
    const direct = await listCatalogsOperation(caller, { limit: '100', cursor: null, clientId: null });
    assert.equal(res.text, JSON.stringify(direct.outcome.body));
  });

  it('pages with limit and nextCursor until the last page', async () => {
    const seen: unknown[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const json = (await as(tokenA).get(`/catalogs?limit=2${cursor ? `&cursor=${cursor}` : ''}`)).body as Json;
      seen.push(...(json['catalogs'] as Json[]).map((c) => c['id']));
      cursor = json['nextCursor'] as string | null;
      if (!cursor) break;
    }
    assert.deepEqual(new Set(seen), new Set(ownCatalogs));
    assert.equal(seen.length, ownCatalogs.length);
  });

  it('another org\'s catalogue is neither a valid cursor nor a client filter', async () => {
    const badCursor = await as(tokenA).get(`/catalogs?cursor=${catalogB}`);
    assert.equal(badCursor.status, 400);
    hasRateHeaders(badCursor);
    documentedError('listCatalogs', badCursor, 'invalid_request');
    const foreignClient = await db.catalog.findUniqueOrThrow({ where: { id: catalogB }, select: { clientId: true } });
    const filtered = await as(tokenA).get(`/catalogs?clientId=${foreignClient.clientId}`);
    assert.equal(filtered.status, 404);
    documentedError('listCatalogs', filtered, 'not_found');
  });

  it('the report of another org\'s catalogue is 404; its own is 200 in the documented shape', async () => {
    const foreign = await as(tokenA).get(`/catalogs/${catalogB}/report`);
    assert.equal(foreign.status, 404);
    hasRateHeaders(foreign);
    documentedError('report', foreign, 'not_found');

    const own = await as(tokenA).get(`/catalogs/${catalogA}/report?limit=10`);
    assert.equal(own.status, 200);
    hasRateHeaders(own);
    const json = own.body as Json;
    assert.deepEqual(Object.keys(json).sort(), props('Report'));
    assert.deepEqual(Object.keys((json['findings'] as Json[])[0] ?? {}).sort(), props('Finding'));
    const caller = await authenticate(`Bearer ${tokenA}`);
    assert.ok(caller);
    assert.equal(own.text, JSON.stringify((await reportOperation(caller, catalogA, { limit: '10', cursor: null })).outcome.body));
  });

  it('the other org\'s key sees only its own catalogue', async () => {
    const json = (await as(tokenB).get('/catalogs')).body as Json;
    assert.deepEqual((json['catalogs'] as Json[]).map((c) => c['id']), [catalogB]);
  });

  it('check: a bad body and a bad Idempotency-Key are documented 400s with rate headers', async () => {
    const bad = await as(tokenA).post('/check').send({ nom: 'x' });
    assert.equal(bad.status, 400);
    hasRateHeaders(bad);
    documentedError('check', bad, 'invalid_request');
    const key = await as(tokenA).post('/check').set('Idempotency-Key', 'has space').send({ name: 'Sut' });
    assert.equal(key.status, 400);
    documentedError('check', key, 'invalid_request');
  });

  it('check: an org whose trial is over gets plan_expired (402)', async () => {
    const res = await as(tokenB).post('/check').send({ name: 'Sut 1 l' });
    assert.equal(res.status, 402);
    documentedError('check', res, 'plan_expired');
  });

  it('check: findings per product; a repeat with the same Idempotency-Key is replayed, a different body is refused', async () => {
    await db.organization.update({ where: { id: a.orgId }, data: { subscriptionUntil: new Date(Date.now() + 30 * 86_400_000) } });
    const key = `check-${Date.now()}`;
    const first = await as(tokenA).post('/check').set('Idempotency-Key', key).send({ items: [{ name: 'Sut 3,2% 1 l' }, { name: 'Guruch', unit: 'kg' }] });
    assert.equal(first.status, 200, first.text);
    hasRateHeaders(first);
    const results = (first.body as { results: Json[] }).results;
    assert.deepEqual(results.map((r) => r['name']), ['Sut 3,2% 1 l', 'Guruch']);
    assert.deepEqual(Object.keys(results[0] ?? {}).sort(), props('CheckResult'));
    assert.equal(first.headers[HEADERS.replayed.toLowerCase()], undefined);

    const replay = await as(tokenA).post('/check').set('Idempotency-Key', key).send({ items: [{ name: 'Sut 3,2% 1 l' }, { name: 'Guruch', unit: 'kg' }] });
    assert.equal(replay.status, 200);
    assert.equal(replay.headers[HEADERS.replayed.toLowerCase()], 'true');
    // The same value; the replay is read back from jsonb, which reorders keys (as in the web app).
    assert.deepEqual(replay.body, first.body);

    const reused = await as(tokenA).post('/check').set('Idempotency-Key', key).send({ name: 'Boshqa narsa' });
    assert.equal(reused.status, 422);
    documentedError('check', reused, 'idempotency_key_reused');
  });

  it('check: beyond the per-process cap of checks in flight a request gets 429 rate_limited with Retry-After (Q1)', async () => {
    await db.organization.update({ where: { id: a.orgId }, data: { subscriptionUntil: new Date(Date.now() + 30 * 86_400_000) } });
    const held: (() => void)[] = [];
    for (let slot = startCheck(); slot; slot = startCheck()) held.push(slot);
    try {
      const key = `busy-${Date.now()}`;
      const busy = await as(tokenA).post('/check').set('Idempotency-Key', key).send({ name: 'Sut 1 l' });
      assert.equal(busy.status, 429, busy.text);
      hasRateHeaders(busy);
      assert.equal(busy.headers[HEADERS.retryAfter.toLowerCase()], '2');
      documentedError('check', busy, 'rate_limited');
      held.pop()?.();
      // The refused request claimed nothing: the retry with the same key runs.
      const retry = await as(tokenA).post('/check').set('Idempotency-Key', key).send({ name: 'Sut 1 l' });
      assert.equal(retry.status, 200, retry.text);
    } finally {
      for (const release of held) release();
    }
    assert.equal(checksInFlight(), 0);
  });

  it('upload: 202 with the stored catalogue, its audit handed to the queue; replayed for the same key', async () => {
    const csv = Buffer.from('Tovar nomi;Birlik\nGuruch;kg\nShakar;kg\n');
    const key = `upload-${Date.now()}`;
    const res = await as(tokenA).post('/catalogs').set('Idempotency-Key', key).attach('file', csv, 'katalog.csv');
    assert.equal(res.status, 202, res.text);
    hasRateHeaders(res);
    const body = res.body as Json;
    assert.deepEqual(Object.keys(body).sort(), props('UploadAccepted'));
    assert.equal(body['status'], 'analyzing');
    assert.equal(body['rows'], 2);
    const stored = await db.catalog.findUniqueOrThrow({ where: { id: body['id'] as string } });
    assert.equal(stored.orgId, a.orgId);
    assert.ok(audits.includes(stored.id));

    const replay = await as(tokenA).post('/catalogs').set('Idempotency-Key', key).attach('file', csv, 'katalog.csv');
    assert.equal(replay.status, 202);
    assert.equal(replay.headers[HEADERS.replayed.toLowerCase()], 'true');
    assert.deepEqual(replay.body, res.body);
    assert.equal(await db.catalog.count({ where: { orgId: a.orgId, filename: 'katalog.csv' } }), 1);
  });

  it('upload: an archived client takes no catalogue (documented 404); a missing file is a documented 400', async () => {
    const archived = await db.client.create({ data: { orgId: a.orgId, name: `archived-${Date.now()}`, archivedAt: new Date() } });
    const res = await as(tokenA).post('/catalogs').field('clientId', archived.id).attach('file', Buffer.from('Tovar\nGuruch\n'), 'katalog.csv');
    assert.equal(res.status, 404);
    documentedError('uploadCatalog', res, 'not_found');
    assert.equal(await db.catalog.count({ where: { clientId: archived.id } }), 0);

    const missing = await as(tokenA).post('/catalogs').field('clientId', archived.id);
    assert.equal(missing.status, 400);
    hasRateHeaders(missing);
    documentedError('uploadCatalog', missing, 'invalid_request');
    const notMultipart = await as(tokenA).post('/catalogs').send({ file: 'x' });
    documentedError('uploadCatalog', notMultipart, 'invalid_request');
  });

  it('429 with Retry-After once the key\'s per-minute budget is spent', async () => {
    const fresh = (await createApiKey({ ...b, role: 'admin' }, 'rate'))?.token ?? '';
    await withEnv({ API_RATE_PER_MINUTE: '2' }, async () => {
      assert.equal((await as(fresh).get('/catalogs')).status, 200);
      const second = await as(fresh).get('/catalogs');
      assert.equal(second.headers[HEADERS.remaining.toLowerCase()], '0');
      const third = await as(fresh).get('/catalogs');
      assert.equal(third.status, 429);
      documentedError('listCatalogs', third, 'rate_limited');
      assert.match(third.headers[HEADERS.retryAfter.toLowerCase()] ?? '', /^\d+$/);
      assert.equal(third.headers[HEADERS.limit.toLowerCase()], '2');
    });
  });

  it('GET /api/v1/openapi.json: the contracts\' v1 document, equal to the old one; no key needed', async () => {
    const res = await http().get('/api/v1/openapi.json').set('Host', 'api.example.test');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, buildOpenApi({ origin: 'http://api.example.test', scope: 'public', config: { ratePerMinute: 60, maxCheckItems: 20 } }));
    assert.deepEqual(res.body, JSON.parse(JSON.stringify(openApiSpec('http://api.example.test'))));
  });
});
