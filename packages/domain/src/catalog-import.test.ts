import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { applyMapping, storeCatalog } from './catalog-import.js';
import { defaultClient } from './clients.js';
import type { ColumnMap } from './column-map.js';
import { db } from '@tasnivo/db';
import { usageOf } from './plan.js';
import { parseUpload } from './spreadsheet.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';
import { discardUpload, uploadPreview } from './upload-preview.js';
import { uploadProgress, etaSeconds } from './upload-progress.js';

const MAP: ColumnMap = { name: 0, barcode: -1, mxik: 2, unit: 1, price: -1, sales: -1 };
const CSV = 'Nomi;Birlik;MXIK;Izoh\nGuruch;kg;06301001001000000;\nShakar;kg;;\n;dona;;\n';

describe('processing estimate', () => {
  it('waits for enough progress, then extrapolates the rate so far', () => {
    const start = new Date('2026-10-19T10:00:00Z');
    assert.equal(etaSeconds(10, 1000, start, new Date('2026-10-19T10:00:30Z')), null);
    assert.equal(etaSeconds(100, 1000, start, new Date('2026-10-19T10:00:02Z')), null);
    assert.equal(etaSeconds(100, 1000, start, new Date('2026-10-19T10:00:10Z')), 90);
    assert.equal(etaSeconds(1000, 1000, start, new Date('2026-10-19T10:01:00Z')), null);
  });
});

const skip = await dbSkipReason();

describe('catalogue import (database)', { skip }, () => {
  let a: TestActor;
  let clientId = '';
  before(async () => {
    a = await makeOrg();
    clientId = (await defaultClient(a.orgId)).id;
  });
  after(async () => {
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  const preview = async (): Promise<string> => {
    const parsed = await parseUpload(Buffer.from(CSV, 'utf8'), 'k.csv');
    return (await storeCatalog({ orgId: a.orgId, userId: a.userId, clientId, filename: 'k.csv', parsed, mapping: MAP })).catalogId;
  };

  it('stores a preview with its import diagnostics, readable for the wizard', async () => {
    const catalogId = await preview();
    const shown = await uploadPreview({ orgId: a.orgId, clientIds: null }, catalogId);
    assert.ok(shown);
    assert.equal(shown.rows, 3);
    assert.equal(shown.diagnostics?.noName.count, 1);
    assert.equal(shown.parse?.delimiter, ';');
    // A scoped accountant without this client sees nothing.
    assert.equal(await uploadPreview({ orgId: a.orgId, clientIds: ['someone-else'] }, catalogId), null);
  });

  it('refuses a second commit of the same upload and keeps its decisions', async () => {
    const catalogId = await preview();
    assert.deepEqual(await applyMapping(a.orgId, catalogId, MAP), { rows: 2 });
    const item = await db.catalogItem.findFirstOrThrow({ where: { catalogId }, orderBy: { rowIndex: 'asc' } });
    const decided = await db.finding.create({
      data: { itemId: item.id, type: 'MISSING', severity: 'high', alternatives: [], reason: 'test', decision: 'accepted', chosenMxik: '06301001001000000', decidedBy: a.userId, decidedAt: new Date() },
    });
    assert.deepEqual(await applyMapping(a.orgId, catalogId, { ...MAP, unit: -1 }), { error: 'not_uploaded' });
    assert.ok(await db.finding.findUnique({ where: { id: decided.id } }), 'the decision survives');
    const after = await db.catalog.findUniqueOrThrow({ where: { id: catalogId }, select: { status: true, columnMap: true } });
    assert.equal(after.status, 'analyzing');
    assert.deepEqual(after.columnMap, MAP);
  });

  it('lets exactly one of two simultaneous commits through', async () => {
    const catalogId = await preview();
    const results = await Promise.all([applyMapping(a.orgId, catalogId, MAP), applyMapping(a.orgId, catalogId, MAP)]);
    assert.equal(results.filter((r) => 'rows' in r).length, 1);
    assert.equal(results.filter((r) => 'error' in r && r.error === 'not_uploaded').length, 1);
    assert.equal(await db.catalogItem.count({ where: { catalogId } }), 2);
  });

  it('releases the claim when the mapping finds no names, so it can be fixed', async () => {
    const catalogId = await preview();
    assert.deepEqual(await applyMapping(a.orgId, catalogId, { ...MAP, name: 3 }), { error: 'no_names' });
    const state = await db.catalog.findUniqueOrThrow({ where: { id: catalogId }, select: { status: true } });
    assert.equal(state.status, 'uploaded');
    assert.deepEqual(await applyMapping(a.orgId, catalogId, { ...MAP, name: 0, unit: 0 }), { error: 'bad_mapping' });
  });

  it('counts rows against the monthly allowance only once committed', async () => {
    const before = (await usageOf(a.orgId)).rowsPerMonth;
    const catalogId = await preview();
    assert.equal((await usageOf(a.orgId)).rowsPerMonth, before, 'a preview is free');
    await applyMapping(a.orgId, catalogId, MAP);
    assert.equal((await usageOf(a.orgId)).rowsPerMonth, before + 2);
    assert.deepEqual(await uploadProgress({ orgId: a.orgId }, catalogId, new Date()), { status: 'analyzing', done: 0, total: 2, etaSeconds: null });
  });

  it('discards only an uncommitted upload, and logs it', async () => {
    const committed = await preview();
    await applyMapping(a.orgId, committed, MAP);
    const actor = { orgId: a.orgId, userId: a.userId, clientIds: null };
    assert.equal(await discardUpload(actor, committed), false);
    const open = await preview();
    assert.equal(await discardUpload({ ...actor, clientIds: ['someone-else'] }, open), false);
    assert.equal(await discardUpload(actor, open), true);
    assert.equal(await db.catalog.count({ where: { id: open } }), 0);
    assert.equal(await db.auditEvent.count({ where: { orgId: a.orgId, action: 'catalog.upload_discarded', targetId: open } }), 1);
  });
});
