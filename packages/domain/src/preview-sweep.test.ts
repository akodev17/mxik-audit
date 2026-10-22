import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { applyMapping, storeCatalog } from './catalog-import.js';
import { defaultClient } from './clients.js';
import type { ColumnMap } from './column-map.js';
import { db } from '@tasnivo/db';
import { planStatus, previewCap, previewGate, PREVIEW_ROWS_UNCAPPED } from './plan.js';
import { discardEarlierPreviews, sweepExpiredPreviews } from './preview-sweep.js';
import { parseUpload } from './spreadsheet.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const MAP: ColumnMap = { name: 0, barcode: -1, mxik: -1, unit: 1, price: -1, sales: -1 };
const CSV = 'Nomi;Birlik\nGuruch;kg\nShakar;kg\n';
const HOUR = 3_600_000;
// The sweep runs over every org: dates in 2001 keep it away from real data.
const NOW = new Date('2001-06-10T12:00:00Z');
const ago = (hours: number): Date => new Date(NOW.getTime() - hours * HOUR);

describe('preview cap', () => {
  it('is the monthly row limit when the plan has one, else a fixed ceiling', () => {
    assert.equal(previewCap({ rowsPerMonth: 5_000 }), 5_000);
    assert.equal(previewCap({ rowsPerMonth: null }), PREVIEW_ROWS_UNCAPPED);
    assert.equal(PREVIEW_ROWS_UNCAPPED, 200_000);
  });
});

const skip = await dbSkipReason();

describe('upload previews (database)', { skip }, () => {
  let a: TestActor;
  let colleague = '';
  let clientId = '';
  before(async () => {
    a = await makeOrg();
    clientId = (await defaultClient(a.orgId)).id;
    colleague = (await db.user.create({ data: { orgId: a.orgId, email: `test-${randomBytes(4).toString('hex')}@test.local`, passwordHash: 'x' } })).id;
  });
  after(async () => {
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  const store = async (userId: string): Promise<string> => {
    const parsed = await parseUpload(Buffer.from(CSV, 'utf8'), 'k.csv');
    return (await storeCatalog({ orgId: a.orgId, userId, clientId, filename: 'k.csv', parsed, mapping: MAP })).catalogId;
  };
  const bare = async (status: 'uploaded' | 'ready', rowCount: number, createdAt: Date): Promise<string> => {
    const c = await db.catalog.create({ data: { orgId: a.orgId, clientId, filename: 'x.csv', rowCount, status, createdAt, headers: ['Nomi'], columnMap: MAP } });
    return c.id;
  };

  it('a new upload replaces only open previews of the same user, and logs each', async () => {
    const first = await store(a.userId);
    const second = await store(a.userId);
    const committed = await store(a.userId);
    await applyMapping(a.orgId, committed, MAP);
    const theirs = await store(colleague);

    assert.equal(await discardEarlierPreviews(a), 2);
    assert.equal(await db.catalog.count({ where: { id: { in: [first, second] } } }), 0);
    assert.equal(await db.catalog.count({ where: { id: { in: [committed, theirs] } } }), 2, 'committed uploads and previews of colleagues stay');
    const events = await db.auditEvent.findMany({ where: { orgId: a.orgId, action: 'catalog.upload_discarded' }, select: { targetId: true, actorId: true, payload: true } });
    assert.deepEqual(new Set(events.map((e) => e.targetId)), new Set([first, second]));
    for (const e of events) {
      assert.equal(e.actorId, a.userId);
      assert.equal((e.payload as { reason: string }).reason, 'replaced');
    }
    await db.catalog.deleteMany({ where: { id: { in: [committed, theirs] } } });
  });

  it('caps the open preview rows of an org from the last 24 hours', async () => {
    const cap = previewCap((await planStatus(a.orgId, NOW)).limits);
    const open = await bare('uploaded', cap - 10, ago(1));
    await bare('uploaded', 1_000, ago(25));
    await bare('ready', 1_000, ago(1));
    assert.deepEqual(await previewGate(a.orgId, 10, NOW), { ok: true });
    assert.deepEqual(await previewGate(a.orgId, 11, NOW), { ok: false, cap });
    await db.catalog.delete({ where: { id: open } });
    assert.deepEqual(await previewGate(a.orgId, 11, NOW), { ok: true });
  });

  it('the daily sweep deletes previews older than 48 hours and logs them without an actor', async () => {
    const old = await bare('uploaded', 3, ago(49));
    const young = await bare('uploaded', 3, ago(47));
    const audited = await bare('ready', 3, ago(100));

    assert.ok((await sweepExpiredPreviews(NOW)) >= 1);
    assert.equal(await db.catalog.count({ where: { id: old } }), 0);
    assert.equal(await db.catalog.count({ where: { id: { in: [young, audited] } } }), 2);
    const event = await db.auditEvent.findFirstOrThrow({ where: { orgId: a.orgId, action: 'catalog.upload_discarded', targetId: old } });
    assert.equal(event.actorId, null);
    assert.equal((event.payload as { reason: string }).reason, 'expired');
  });
});
