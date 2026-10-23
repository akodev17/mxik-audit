import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { applyMapping, storeCatalog } from './catalog-import.js';
import { deleteCatalog } from './catalogs.js';
import { defaultClient } from './clients.js';
import type { ColumnMap } from './column-map.js';
import { gate, usageOf } from './plan.js';
import { parseUpload } from './spreadsheet.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const MAP: ColumnMap = { name: 0, barcode: -1, mxik: -1, unit: 1, price: -1, sales: -1 };
const csv = (rows: number): string => ['Nomi;Birlik', ...Array.from({ length: rows }, (_, i) => `Mahsulot ${i};dona`)].join('\n');

const skip = await dbSkipReason();

describe('monthly row usage survives deletion (database)', { skip }, () => {
  let a: TestActor;
  let clientId = '';
  before(async () => {
    a = await makeOrg();
    await db.organization.update({ where: { id: a.orgId }, data: { trialEndsAt: new Date(Date.now() + 14 * 86_400_000) } });
    clientId = (await defaultClient(a.orgId)).id;
  });
  after(async () => {
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  const commit = async (rows: number): Promise<string> => {
    const parsed = await parseUpload(Buffer.from(csv(rows), 'utf8'), 'k.csv');
    const { catalogId } = await storeCatalog({ orgId: a.orgId, userId: a.userId, clientId, filename: 'k.csv', parsed, mapping: MAP });
    assert.deepEqual(await applyMapping(a.orgId, catalogId, MAP), { rows });
    return catalogId;
  };

  it('deleting a committed catalogue does not give its rows back', async () => {
    const catalogId = await commit(40);
    assert.equal((await usageOf(a.orgId)).rowsPerMonth, 40);
    assert.ok((await deleteCatalog({ ...a, clientIds: null }, catalogId)).ok);
    assert.equal((await usageOf(a.orgId)).rowsPerMonth, 40, 'the trial allowance stays consumed');
  });

  it('upload, delete, upload again cannot pass the trial cap', async () => {
    const used = (await usageOf(a.orgId)).rowsPerMonth;
    const room = 5_000 - used;
    assert.deepEqual(await gate(a.orgId, 'rowsPerMonth', room), { ok: true });
    const big = await commit(room);
    assert.ok((await deleteCatalog({ ...a, clientIds: null }, big)).ok);
    assert.deepEqual(await gate(a.orgId, 'rowsPerMonth', 1), { ok: false, reason: 'rowsPerMonth' });
  });
});
