import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { rerankCacheKey } from '../core/match/rerank-cache.js';
import { normalizeName } from '../core/normalize/index.js';
import { catalogList, deleteCatalog, listCatalogs, resolveCatalog } from './catalogs.js';
import { db } from './db.js';
import { recordDecision } from './decisions.js';
import { dbSkipReason, dropOrgs, liveCodes, makeCatalog, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

describe('catalogue history and deletion (database)', { skip }, () => {
  let a: TestActor;
  let b: TestActor;
  let code = '';

  before(async () => {
    code = (await liveCodes(1))[0] ?? '';
    a = await makeOrg();
    b = await makeOrg();
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  it('lists only the org’s own catalogues, newest first, and resolves any of them', async () => {
    const older = await makeCatalog(a.orgId, [{ rawName: 'Un', suggestedMxik: code, confidence: 0.8 }]);
    const newer = await makeCatalog(a.orgId, [{ rawName: 'Tuz', suggestedMxik: code, confidence: 0.8 }]);
    const foreign = await makeCatalog(b.orgId, [{ rawName: 'Yog', suggestedMxik: code, confidence: 0.8 }]);

    const list = await listCatalogs(a.orgId);
    assert.deepEqual(list.slice(0, 2).map((c) => c.id), [newer.catalogId, older.catalogId]);
    assert.ok(!list.some((c) => c.id === foreign.catalogId));
    assert.equal(list[0]?.riskyRows, 1);

    assert.equal((await resolveCatalog(a.orgId))?.id, newer.catalogId);
    assert.equal((await resolveCatalog(a.orgId, older.catalogId))?.id, older.catalogId);
    assert.equal(await resolveCatalog(a.orgId, foreign.catalogId), null);
  });

  it('deletes the catalogue, its rows, findings and cached verdicts, keeps its audit events and adds a tombstone', async () => {
    const { catalogId, findingIds } = await makeCatalog(a.orgId, [{ rawName: 'Shakar 1 kg', unit: 'kg', suggestedMxik: code, confidence: 0.95 }]);
    const decided = await recordDecision(a, { findingId: findingIds[0] ?? '', decision: 'accepted' });
    assert.ok(decided.ok);
    const before = await db.auditEvent.findUnique({ where: { id: decided.eventId } });
    const key = rerankCacheKey('claude-test', normalizeName('Shakar 1 kg').matchKey, 'kg');
    await db.$executeRaw`INSERT INTO rerank_cache (scope, key, model, verdicts) VALUES (${a.orgId}, ${key}, 'claude-test', '[]'::jsonb)`;

    const r = await deleteCatalog(a, catalogId);
    assert.ok(r.ok);
    assert.equal(r.rows, 1);
    assert.equal(r.findings, 1);
    assert.equal(r.cacheEntries, 1);
    assert.ok(r.keptEvents >= 1);

    assert.equal(await db.catalog.count({ where: { id: catalogId } }), 0);
    assert.equal(await db.catalogItem.count({ where: { catalogId } }), 0);
    assert.equal(await db.finding.count({ where: { id: { in: findingIds } } }), 0);
    // The log is append-only: the decision event is still there, unchanged.
    assert.deepEqual(await db.auditEvent.findUnique({ where: { id: decided.eventId } }), before);
    const left = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM rerank_cache WHERE scope = ${a.orgId} AND key = ${key}`;
    assert.equal(Number(left[0]?.n), 0);

    const tombstone = await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'catalog.deleted', targetId: catalogId } });
    assert.ok(tombstone);
    const payload = tombstone.payload as Record<string, unknown>;
    assert.equal(payload['filename'], 'test.xlsx');
    assert.equal(payload['rows'], 1);
    assert.equal(payload['findings'], 1);
    assert.equal(payload['catalogId'], catalogId);
    assert.ok(!JSON.stringify(payload).includes('Shakar'), 'tombstone must not carry product names');
  });

  it('lists catalogues with the uploader, hides unaudited risk counts and archived clients, and keeps to the scope', async () => {
    const hidden = await db.client.create({ data: { orgId: a.orgId, name: 'Arxiv', archivedAt: new Date() }, select: { id: true } });
    const archivedCatalog = await makeCatalog(a.orgId, [{ rawName: 'Yashirin', suggestedMxik: code, confidence: 0.8 }]);
    await db.catalog.update({ where: { id: archivedCatalog.catalogId }, data: { clientId: hidden.id } });
    const pending = await makeCatalog(a.orgId, [{ rawName: 'Kutilmoqda', suggestedMxik: code, confidence: 0.8 }]);
    await db.catalog.update({ where: { id: pending.catalogId }, data: { status: 'uploaded' } });
    await db.auditEvent.create({ data: { orgId: a.orgId, actorId: a.userId, action: 'catalog.uploaded', targetId: pending.catalogId, payload: { via: 'telegram' } } });

    const { items } = await catalogList({ orgId: a.orgId, clientIds: null }, null);
    assert.ok(!items.some((c) => c.id === archivedCatalog.catalogId), 'archived clients are left out of "all clients"');
    assert.ok(!items.some((c) => c.id === pending.catalogId), 'an unconfirmed upload is not listed as a catalogue');
    const drafts = await catalogList({ orgId: a.orgId, clientIds: null }, null, 0, 'drafts');
    assert.deepEqual(drafts.items.map((c) => c.id), [pending.catalogId]);
    const row = drafts.items.find((c) => c.id === pending.catalogId);
    assert.equal(row?.riskyRows, null);
    assert.equal(row?.viaTelegram, true);
    assert.ok(row?.uploader?.startsWith('test-'));
    assert.ok(items.filter((c) => c.filename === 'test.xlsx').every((c) => c.repeatedName));

    const direct = await catalogList({ orgId: a.orgId, clientIds: null }, hidden.id);
    assert.deepEqual(direct.items.map((c) => c.id), [archivedCatalog.catalogId]);
    const scoped = await catalogList({ orgId: a.orgId, clientIds: ['nobody'] }, hidden.id);
    assert.deepEqual(scoped.items, []);
  });

  it('refuses to delete another org’s catalogue', async () => {
    const foreign = await makeCatalog(b.orgId, [{ rawName: 'Guruch', suggestedMxik: code, confidence: 0.8 }]);
    assert.equal((await deleteCatalog(a, foreign.catalogId)).ok, false);
    assert.equal(await db.catalog.count({ where: { id: foreign.catalogId } }), 1);
  });
});
