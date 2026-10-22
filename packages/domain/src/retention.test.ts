import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { db } from './db.js';
import { deleteLead, leadFileRetentionDays, purgeLeadFiles } from './retention.js';
import { dbSkipReason } from './test-fixtures.js';

const skip = await dbSkipReason();

describe('lead file retention', () => {
  it('defaults to 30 days and reads LEAD_FILE_RETENTION_DAYS', () => {
    assert.equal(leadFileRetentionDays({}), 30);
    assert.equal(leadFileRetentionDays({ LEAD_FILE_RETENTION_DAYS: '7' }), 7);
    assert.equal(leadFileRetentionDays({ LEAD_FILE_RETENTION_DAYS: 'junk' }), 30);
  });
});

describe('lead file retention (database)', { skip }, () => {
  const ids: string[] = [];
  const lead = async (daysOld: number) => {
    const row = await db.lead.create({
      data: {
        contact: `test-${Math.random().toString(36).slice(2)}`, filename: 'k.xlsx', fileBytes: 3,
        fileData: new Uint8Array([1, 2, 3]), createdAt: new Date(Date.now() - daysOld * 86_400_000),
      },
    });
    ids.push(row.id);
    return row.id;
  };
  after(async () => {
    await db.lead.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  });

  it('erases files past the retention window and keeps newer ones', async () => {
    const old = await lead(40);
    const fresh = await lead(1);
    await purgeLeadFiles(new Date(), 30);
    const [o, f] = await Promise.all([db.lead.findUnique({ where: { id: old } }), db.lead.findUnique({ where: { id: fresh } })]);
    assert.equal(o?.fileData, null);
    assert.ok(o?.fileDeletedAt);
    assert.ok(f?.fileData);
    assert.equal(f?.fileDeletedAt, null);
  });

  it('erases one lead’s file on request, or the whole lead', async () => {
    const id = await lead(0);
    assert.ok(await deleteLead(id, false));
    const row = await db.lead.findUnique({ where: { id } });
    assert.equal(row?.fileData, null);
    assert.ok(row?.contact);
    assert.ok(await deleteLead(id, true));
    assert.equal(await db.lead.count({ where: { id } }), 0);
  });
});
