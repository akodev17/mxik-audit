import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '../db.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from '../test-fixtures.js';
import { mappedColumns, purgeRawFiles } from './account.js';

const skip = await dbSkipReason();

describe('raw file retention', () => {
  it('keeps only the columns the mapping uses', () => {
    assert.deepEqual(mappedColumns({ name: 0, barcode: -1, mxik: 2, unit: 1 }), [0, 2, 1]);
    assert.deepEqual(mappedColumns(null), []);
  });
});

// Dates are in 2001 so the job, which runs over every org, cannot reach real data:
// any real org's rawRetentionSince is later than the cutoff and is skipped.
const NOW = new Date('2001-03-01T00:00:00Z');
const SINCE = new Date('2001-01-10T00:00:00Z');

describe('raw file retention (database)', { skip }, () => {
  let a: TestActor;
  let noSince: TestActor;
  before(async () => {
    a = await makeOrg();
    noSince = await makeOrg();
    await db.organization.update({ where: { id: a.orgId }, data: { rawRetentionDays: 7, rawRetentionSince: SINCE } });
    await db.organization.update({ where: { id: noSince.orgId }, data: { rawRetentionDays: 7, rawRetentionSince: null } });
  });
  after(async () => {
    await dropOrgs([a.orgId, noSince.orgId]);
    await db.$disconnect();
  });

  const upload = async (orgId: string, createdAt: string): Promise<string> => {
    const catalog = await db.catalog.create({
      data: {
        orgId, filename: 'k.xlsx', rowCount: 1, status: 'ready', createdAt: new Date(createdAt),
        headers: ['Nomi', 'Izoh'], columnMap: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1, sales: -1 },
      },
    });
    await db.catalogItem.create({ data: { catalogId: catalog.id, rowIndex: 0, rawName: 'Guruch', normalizedName: 'guruch', attrs: { original: ['Guruch', 'maxfiy izoh'] } } });
    return catalog.id;
  };
  const state = async (catalogId: string) => {
    const c = await db.catalog.findUniqueOrThrow({ where: { id: catalogId }, select: { rawPurgedAt: true } });
    const item = await db.catalogItem.findFirstOrThrow({ where: { catalogId }, select: { attrs: true } });
    return { purged: c.rawPurgedAt !== null, original: (item.attrs as { original: string[] }).original };
  };

  it('blanks only uploads made since rawRetentionSince and older than the window', async () => {
    const beforeSince = await upload(a.orgId, '2001-01-05T00:00:00Z');
    const due = await upload(a.orgId, '2001-01-20T00:00:00Z');
    const recent = await upload(a.orgId, '2001-02-27T00:00:00Z');
    const unset = await upload(noSince.orgId, '2001-01-20T00:00:00Z');

    await purgeRawFiles(NOW);

    assert.deepEqual(await state(beforeSince), { purged: false, original: ['Guruch', 'maxfiy izoh'] }, 'an upload from before the rule is untouched');
    assert.deepEqual(await state(due), { purged: true, original: ['Guruch', ''] });
    assert.deepEqual(await state(recent), { purged: false, original: ['Guruch', 'maxfiy izoh'] });
    assert.deepEqual(await state(unset), { purged: false, original: ['Guruch', 'maxfiy izoh'] }, 'an org without rawRetentionSince is skipped');
    assert.equal(await db.auditEvent.count({ where: { orgId: a.orgId, action: 'retention.purged' } }), 1);
    assert.equal(await db.auditEvent.count({ where: { orgId: noSince.orgId, action: 'retention.purged' } }), 0);
  });
});
