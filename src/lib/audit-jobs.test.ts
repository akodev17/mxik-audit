import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { isAuditRunning, resumeStaleAudits, retryAudit, startAudit, STARTUP_STALE_MS } from './audit-jobs.js';
import { auditCatalog } from './audit-runner.js';
import { db } from './db.js';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

/** A catalogue of rows with no findings yet, the state an upload leaves it in. */
async function rawCatalog(orgId: string, rows: { name: string; code: string | null }[], status: 'uploaded' | 'analyzing' = 'uploaded') {
  const catalog = await db.catalog.create({
    data: {
      orgId, filename: 'jobs.xlsx', rowCount: rows.length, status,
      headers: ['name', 'mxik'], columnMap: { name: 0, barcode: -1, mxik: 1, unit: -1, price: -1 },
    },
  });
  await db.catalogItem.createMany({
    data: rows.map((r, rowIndex) => ({
      catalogId: catalog.id, rowIndex, rawName: r.name, normalizedName: '', existingMxik: r.code,
      attrs: { original: [r.name, r.code ?? ''] },
    })),
  });
  return catalog.id;
}

async function waitFor(catalogId: string, status: 'ready' | 'failed', timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const c = await db.catalog.findUnique({ where: { id: catalogId }, select: { status: true, auditError: true } });
    if (c?.status === status) return;
    if (Date.now() > deadline) throw new Error(`catalogue still ${c?.status}: ${c?.auditError ?? ''}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe('background audits (database)', { skip }, () => {
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

  it('returns at once and finishes the audit in the background', async () => {
    const id = await rawCatalog(a.orgId, [{ name: 'Kartoshka', code: null }, { name: 'Guruch', code: '99999999999999999' }]);
    await startAudit(id, a);
    const right = await db.catalog.findUnique({ where: { id }, select: { status: true } });
    assert.equal(right?.status, 'analyzing');

    await waitFor(id, 'ready');
    const catalog = await db.catalog.findUnique({ where: { id } });
    assert.equal(catalog?.progressDone, 2);
    const types = (await db.finding.findMany({ where: { item: { catalogId: id } }, select: { type: true } })).map((f) => f.type).sort();
    assert.deepEqual(types, ['MISSING', 'NOT_FOUND']);
    assert.ok(await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'catalog.audited', targetId: id } }));
  });

  it('resumes an orphaned audit from its watermark, redoing only unfinished rows', async () => {
    const id = await rawCatalog(a.orgId, [{ name: 'Kartoshka', code: null }, { name: 'Shakar', code: null }], 'analyzing');
    await db.catalog.update({ where: { id }, data: { progressDone: 1, auditHeartbeatAt: new Date(Date.now() - 10 * 60_000) } });
    const items = await db.catalogItem.findMany({ where: { catalogId: id }, orderBy: { rowIndex: 'asc' } });
    // Row 0 finished before the crash; row 1 has a half-written finding.
    const kept = await db.finding.create({ data: { itemId: items[0]?.id ?? '', type: 'MISSING', severity: 'high', alternatives: [], reason: 'before crash' } });
    await db.finding.create({ data: { itemId: items[1]?.id ?? '', type: 'MISMATCH', severity: 'medium', alternatives: [], reason: 'half-written' } });

    await resumeStaleAudits(0, id);
    await waitFor(id, 'ready');

    assert.ok(await db.finding.findUnique({ where: { id: kept.id } }), 'finished rows are not redone');
    const row1 = await db.finding.findMany({ where: { itemId: items[1]?.id ?? '' } });
    assert.deepEqual(row1.map((f) => f.type), ['MISSING']);
  });

  it('leaves an audit another process is running alone on server start', async () => {
    // CLI scripts mark the catalogue analyzing, with no heartbeat yet, and audit it themselves.
    const id = await rawCatalog(a.orgId, [{ name: 'Kartoshka', code: null }], 'analyzing');
    const audit = auditCatalog(id);
    for (let i = 0; i < 100; i++) {
      const c = await db.catalog.findUnique({ where: { id }, select: { auditHeartbeatAt: true } });
      if (c?.auditHeartbeatAt) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(await resumeStaleAudits(STARTUP_STALE_MS, id), 0);
    assert.equal(isAuditRunning(id), false);
    await audit;
    await db.catalog.update({ where: { id }, data: { status: 'ready' } });
  });

  it('lets only the owning org retry a failed audit', async () => {
    const id = await rawCatalog(a.orgId, [{ name: 'Tuz', code }]);
    await db.catalog.update({ where: { id }, data: { status: 'failed', auditError: 'boom' } });
    assert.equal(await retryAudit(b, id), false);
    assert.equal((await db.catalog.findUnique({ where: { id } }))?.status, 'failed');
    assert.equal(await retryAudit(a, id), true);
    await waitFor(id, 'ready');
  });
});
