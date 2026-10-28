import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { defaultClient } from './clients.js';
import { db } from '@tasnivo/db';
import { deleteDocList, storeDocList } from './docs.js';
import { applyPurchaseMap, deletePurchaseList, runPurchaseCheck, setClientActivity, storePurchaseList } from './purchases.js';
import { parseUpload } from './spreadsheet.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const SOLD = '06301001001000000';
const BOUGHT = '06301001002000000';

const skip = await dbSkipReason();

describe('purchase lists (database)', { skip }, () => {
  let a: TestActor;
  let clientId = '';
  let catalogId = '';
  const actor = () => ({ orgId: a.orgId, userId: a.userId, clientIds: null });
  // An accountant assigned to some other client only.
  const outsider = () => ({ orgId: a.orgId, userId: a.userId, clientIds: ['another-client'] });
  const file = (csv: string) => parseUpload(Buffer.from(csv, 'utf8'), 'kirim.csv');

  before(async () => {
    a = await makeOrg();
    clientId = (await defaultClient(a.orgId)).id;
    await db.client.update({ where: { id: clientId }, data: { activity: 'savdo' } });
    const catalog = await db.catalog.create({
      data: { orgId: a.orgId, clientId, filename: 'sotuv.xlsx', rowCount: 1, status: 'ready', headers: ['Nomi', 'MXIK'], columnMap: { name: 0, barcode: -1, mxik: 1, unit: -1, price: -1, sales: -1, tnved: -1 } },
    });
    catalogId = catalog.id;
    await db.catalogItem.create({ data: { catalogId, rowIndex: 0, rawName: 'Guruch', normalizedName: 'guruch', existingMxik: SOLD, attrs: { original: ['Guruch', SOLD] } } });
  });
  after(async () => {
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  const notPurchased = () => db.finding.count({ where: { item: { catalogId }, type: 'NOT_PURCHASED' } });

  it('keeps a list without a single valid code unused instead of flagging every sale', async () => {
    const stored = await storePurchaseList(actor(), { clientId, filename: 'kirim.csv', parsed: await file('Nomi;Kod\nGuruch;yoʻq\nShakar;123\n') });
    assert.ok(stored.ok);
    const applied = await applyPurchaseMap(actor(), stored.listId, { name: 0, mxik: 1, unit: -1 });
    assert.deepEqual(applied, { ok: false, error: 'no_codes' });
    const list = await db.purchaseList.findUniqueOrThrow({ where: { id: stored.listId }, select: { status: true, meta: true } });
    assert.equal(list.status, 'uploaded');
    assert.ok(list.meta, 'the sample rows are kept for resuming the mapping');
    assert.equal(await runPurchaseCheck(catalogId), 0);
    assert.equal(await notPurchased(), 0);

    // Even a list marked ready by older code, without valid codes, concludes nothing.
    await db.purchaseList.update({ where: { id: stored.listId }, data: { status: 'ready' } });
    assert.equal(await runPurchaseCheck(catalogId), 0);
    await db.purchaseList.update({ where: { id: stored.listId }, data: { status: 'uploaded' } });
  });

  it('uses a list with codes and flags sales that were not bought', async () => {
    const stored = await storePurchaseList(actor(), { clientId, filename: 'kirim2.csv', parsed: await file(`Nomi;Kod\nUn;${BOUGHT}\n`) });
    assert.ok(stored.ok);
    assert.deepEqual(await applyPurchaseMap(actor(), stored.listId, { name: 0, mxik: 1, unit: -1 }), { ok: true, codes: 1 });
    assert.equal(await notPurchased(), 1);
    assert.equal(await db.auditEvent.count({ where: { orgId: a.orgId, action: 'purchases.mapped', targetId: stored.listId } }), 1);
  });

  it('refuses an accountant who is not assigned to the client', async () => {
    const list = await db.purchaseList.findFirstOrThrow({ where: { orgId: a.orgId, status: 'ready' }, select: { id: true } });
    const parsed = await file(`Nomi;Kod\nUn;${BOUGHT}\n`);
    assert.deepEqual(await storePurchaseList(outsider(), { clientId, filename: 'x.csv', parsed }), { ok: false, error: 'not_found' });
    assert.deepEqual(await applyPurchaseMap(outsider(), list.id, { name: 0, mxik: 1, unit: -1 }), { ok: false, error: 'not_found' });
    assert.equal(await deletePurchaseList(outsider(), list.id), false);
    assert.equal(await setClientActivity(outsider(), clientId, 'boshqa'), false);
    assert.equal(await storeDocList(outsider(), { clientId, kind: 'sales', filename: 'x.csv', parsed }), null);
    assert.ok(await db.purchaseList.findUnique({ where: { id: list.id } }), 'the list is untouched');
    const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { activity: true } });
    assert.equal(client.activity, 'savdo');
  });

  it('deletes a list with an audit event and re-checks the catalogue', async () => {
    const list = await db.purchaseList.findFirstOrThrow({ where: { orgId: a.orgId, status: 'ready' }, select: { id: true } });
    assert.equal(await deletePurchaseList(actor(), list.id), true);
    assert.equal(await db.auditEvent.count({ where: { orgId: a.orgId, action: 'purchases.deleted', targetId: list.id } }), 1);
    // No usable purchases are left, so nothing can be concluded.
    assert.equal(await notPurchased(), 0);
  });

  it('deletes a cheque list with an audit event', async () => {
    const stored = await storeDocList(actor(), { clientId, kind: 'cheques', filename: 'chek.csv', parsed: await file(`Nomi;Kod\nUn;${BOUGHT}\n`) });
    assert.ok(stored);
    assert.equal(await deleteDocList(outsider(), stored.listId), false);
    assert.equal(await deleteDocList(actor(), stored.listId), true);
    assert.equal(await db.auditEvent.count({ where: { orgId: a.orgId, action: 'cheques.deleted', targetId: stored.listId } }), 1);
  });
});
