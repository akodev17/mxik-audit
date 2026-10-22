// Integration: what a bulk accept may decide. Runs against the dev database; skips when it is not there.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { FindingType } from '@prisma/client';
import { dictionaryKeys } from '@tasnivo/core/match/dictionary';
import { bulkApply, bulkPreview } from './bulk.js';
import { db } from '@tasnivo/db';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg, type TestActor } from './test-fixtures.js';
import { readFilter } from './workspace-filter.js';

const skip = await dbSkipReason();

type Spec = { type: FindingType; rawName: string; suggestedMxik?: string | null; existingMxik?: string | null };

async function catalogWith(orgId: string, rows: Spec[]): Promise<{ catalogId: string; ids: string[] }> {
  const catalog = await db.catalog.create({
    data: { orgId, filename: 'bulk.xlsx', rowCount: rows.length, status: 'ready', headers: ['name'], columnMap: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1 } },
  });
  const ids: string[] = [];
  for (const [rowIndex, r] of rows.entries()) {
    const item = await db.catalogItem.create({
      data: { catalogId: catalog.id, rowIndex, rawName: r.rawName, normalizedName: '', existingMxik: r.existingMxik ?? null, attrs: { original: [] } },
    });
    const finding = await db.finding.create({
      data: { itemId: item.id, type: r.type, severity: 'high', suggestedMxik: r.suggestedMxik ?? null, confidence: 0.8, alternatives: [], reason: 'test' },
    });
    ids.push(finding.id);
  }
  return { catalogId: catalog.id, ids };
}

const keyOf = (rawName: string): string => dictionaryKeys({ rawName }).name ?? '';

describe('bulk accept (database)', { skip }, () => {
  let a: TestActor;
  let codes: string[] = [];

  before(async () => {
    codes = await liveCodes(2);
    a = await makeOrg();
  });
  after(async () => {
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  it('never confirms a current code in bulk: purchase and privilege checks are skipped, counted and teach nothing', async () => {
    const [x = '', y = ''] = codes;
    const tag = randomBytes(3).toString('hex');
    const names = { missing: `Ommaviy yangi ${tag}`, unit: `Ommaviy birlik ${tag}`, purchase: `Ommaviy xarid ${tag}`, privilege: `Ommaviy imtiyoz ${tag}` };
    const c = await catalogWith(a.orgId, [
      { type: 'MISSING', rawName: names.missing, suggestedMxik: x },
      { type: 'UNIT_CONFLICT', rawName: names.unit, existingMxik: y },
      { type: 'NOT_PURCHASED', rawName: names.purchase, existingMxik: y },
      { type: 'PRIVILEGE_CODE', rawName: names.privilege, existingMxik: y },
    ]);
    const [missing = '', unit = '', purchase = '', privilege = ''] = c.ids;
    const all = readFilter({});

    const dry = await bulkPreview(a, c.catalogId, { filter: all }, { kind: 'accept' });
    assert.ok(dry.ok);
    assert.equal(dry.confirmOnly, 2);
    assert.equal(dry.willTouch, 2, 'the dry run leaves out what it will skip');
    const picked = await bulkPreview(a, c.catalogId, { ids: c.ids }, { kind: 'accept' });
    assert.ok(picked.ok && picked.confirmOnly === 2 && picked.willTouch === 2);
    const flag = await bulkPreview(a, c.catalogId, { filter: all }, { kind: 'flag', flag: 'ask_client' });
    assert.ok(flag.ok && flag.confirmOnly === 0 && flag.willTouch === 4);

    const done = await bulkApply(a, c.catalogId, { filter: all }, { kind: 'accept' });
    assert.ok(done.ok && done.eventId);
    assert.equal(done.count, 2);
    assert.equal(done.skipped.confirmOnly, 2);
    assert.deepEqual([...done.ids].sort(), [missing, unit].sort());
    assert.equal((await db.finding.findUnique({ where: { id: unit } }))?.chosenMxik, y, 'a unit fix still records the current code');
    for (const id of [purchase, privilege]) assert.equal((await db.finding.findUnique({ where: { id } }))?.decision, 'pending');
    const event = await db.auditEvent.findUniqueOrThrow({ where: { id: done.eventId } });
    assert.equal((event.payload as { skipped: { confirmOnly: number } }).skipped.confirmOnly, 2);

    const learned = await db.firmMapping.findMany({ where: { orgId: a.orgId, kind: 'name', key: { in: Object.values(names).map(keyOf) } }, select: { key: true, code: true } });
    assert.deepEqual(learned.map((m) => m.key).sort(), [keyOf(names.missing), keyOf(names.unit)].sort(), 'only accepted rows teach the dictionary');

    const rejected = await bulkApply(a, c.catalogId, { ids: [purchase] }, { kind: 'reject' });
    assert.ok(rejected.ok && rejected.count === 1 && rejected.skipped.confirmOnly === 0, 'a bulk reject still works on them');
    const assigned = await bulkApply(a, c.catalogId, { ids: [privilege] }, { kind: 'assign', code: x });
    assert.ok(assigned.ok && assigned.count === 1, 'one code picked by a person may still be assigned');
  });
});
