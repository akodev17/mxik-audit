import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { defaultClient } from './clients.js';
import { db } from '@tasnivo/db';
import { storeDocList, writeDocMap } from './docs.js';
import { codeUnits, exportItems } from './export-rows.js';
import { reportPdfData } from './pdf/report-data.js';
import { parseUpload } from './spreadsheet.js';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg, type TestActor } from './test-fixtures.js';
import { versionDiff } from './versions.js';

const skip = await dbSkipReason();

describe('export, report and version data (database)', { skip }, () => {
  let a: TestActor;
  let codes: string[] = [];
  let nextId = '';
  let email = '';

  const catalog = (clientId: string, previousId: string | null) => db.catalog.create({
    data: { orgId: a.orgId, clientId, previousId, filename: 'k.xlsx', rowCount: 2, status: 'ready', headers: ['Nomi', 'Birlik', 'MXIK'], columnMap: { name: 0, barcode: -1, mxik: 2, unit: 1, price: -1, sales: -1, tnved: -1 } },
  });
  const item = (catalogId: string, rowIndex: number, rawName: string, existingMxik: string | null) => db.catalogItem.create({
    data: { catalogId, rowIndex, rawName, normalizedName: rawName.toLowerCase(), unit: 'kg', existingMxik, attrs: { original: [rawName, 'kg', existingMxik ?? ''] } },
  });
  const finding = (itemId: string, type: 'MISSING' | 'MISMATCH', decision: 'pending' | 'accepted', extra: { chosenMxik?: string; decisionSource?: string } = {}) => db.finding.create({
    data: {
      itemId, type, severity: 'high', alternatives: [], reason: 'test', decision,
      ...(decision === 'accepted' ? { decidedBy: a.userId, decidedAt: new Date() } : {}), ...extra,
    },
  });

  before(async () => {
    a = await makeOrg();
    codes = await liveCodes(2);
    email = (await db.user.findUniqueOrThrow({ where: { id: a.userId }, select: { email: true } })).email;
    const clientId = (await defaultClient(a.orgId)).id;
    const prev = await catalog(clientId, null);
    const p0 = await item(prev.id, 0, 'Guruch Lazer 1 kg', null);
    await item(prev.id, 1, 'Shakar oq 1 kg', null);
    await finding(p0.id, 'MISSING', 'accepted', { chosenMxik: codes[0], decisionSource: 'manual' });

    const next = await catalog(clientId, prev.id);
    nextId = next.id;
    const n0 = await item(next.id, 0, 'Guruch Lazer 1 kg', null);
    const n1 = await item(next.id, 1, 'Shakar oq 1 kg', codes[1] ?? null);
    await finding(n0.id, 'MISSING', 'accepted', { chosenMxik: codes[0], decisionSource: 'carry_over' });
    await finding(n0.id, 'MISMATCH', 'pending');
    await finding(n1.id, 'MISMATCH', 'pending');
  });
  after(async () => {
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  it('exports the latest accepted code and marks a row with a pending sibling as partly reviewed', async () => {
    const items = await exportItems(nextId);
    assert.deepEqual(items.map((i) => [i.effective.code, i.effective.review]), [[codes[0], 'partial'], [codes[1], 'pending']]);
    const units = await codeUnits([codes[0] ?? '', 'not-a-code']);
    assert.deepEqual([...units.keys()], [codes[0]]);
  });

  it('separates detected issues, decisions (automatic ones named) and unresolved rows in the report', async () => {
    const data = await reportPdfData(a.orgId, nextId);
    assert.ok(data);
    assert.equal(data.riskyRows, 2);
    assert.deepEqual(data.counts, { detected: 3, suggested: 0, decided: 1, automatic: 1, unresolved: 2 });
    assert.deepEqual(data.rowReview, { done: 0, partial: 1, open: 1 });
    assert.deepEqual(data.rows.map((r) => r.decision), ['pending', 'pending', 'accepted']);
    const decided = data.rows[2];
    assert.equal(decided?.automatic, true);
    assert.equal(decided?.decidedBy, email);
    assert.equal(await reportPdfData('another-org', nextId), null);
  });

  it('describes the version change: unchanged, changed, carried with the original decider, re-review', async () => {
    const diff = await versionDiff(a.orgId, nextId);
    assert.ok(diff);
    assert.deepEqual(diff.counts, { added: 0, removed: 0, changed: 1, unchanged: 1, statusChanged: 0, reReview: 1, carried: 1 });
    assert.deepEqual(diff.changed[0]?.notes, ['code']);
    assert.deepEqual(diff.carried.map((c) => [c.rowIndex, c.decision, c.code, c.decidedBy]), [[0, 'accepted', codes[0], email]]);
    assert.equal(diff.reReview[0]?.rowIndex, 0);
  });

  it('writes a cheque list mapping in bulk and counts amounts that read two ways', async () => {
    const clientId = (await defaultClient(a.orgId)).id;
    const parsed = await parseUpload(Buffer.from('Nomi;Kod;Soni;Summa;Sana\nUn;06301001001000000;1,5;12,500;19.10.2026\nTuz;;2;7;\n', 'utf8'), 'chek.csv');
    const stored = await storeDocList({ orgId: a.orgId, userId: a.userId, clientIds: null }, { clientId, kind: 'cheques', filename: 'chek.csv', parsed });
    assert.ok(stored);
    const meta = await writeDocMap(stored.listId, { name: 0, mxik: 1, unit: -1, quantity: 2, amount: 3, date: 4 }, null);
    assert.equal(meta.ambiguous, 1);
    const lines = await db.docItem.findMany({ where: { listId: stored.listId }, orderBy: { rowIndex: 'asc' } });
    assert.deepEqual(lines.map((l) => [l.name, l.mxik, Number(l.quantity), Number(l.amount), l.occurredAt?.toISOString().slice(0, 10) ?? null]), [
      ['Un', '06301001001000000', 1.5, 12500, '2026-10-19'],
      ['Tuz', null, 2, 7, null],
    ]);
  });
});
