// The worker end to end, in this process: real Redis (own key prefix) and the test database.
// Skipped unless both answer. Audits load the embedding model the stored vectors need, as any audit does.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplicationContext } from '@nestjs/common';
import { Redis } from 'ioredis';
import { db } from '@tasnivo/db';
import { resumeStaleAudits, startAudit } from '@tasnivo/domain/audit-jobs';
import { jobs } from '@tasnivo/domain/jobs/dispatcher';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from '@tasnivo/domain/test-fixtures';
import { startWorker, stopWorker } from './worker.js';

const REDIS = process.env['TEST_REDIS_URL'] ?? process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';

async function redisSkipReason(): Promise<string | false> {
  const probe = new Redis(REDIS, { lazyConnect: true, connectTimeout: 500, maxRetriesPerRequest: 0, retryStrategy: () => null });
  probe.on('error', () => undefined);
  try {
    await probe.connect();
    await probe.ping();
    return false;
  } catch {
    return `no Redis at ${REDIS}`;
  } finally {
    probe.disconnect();
  }
}

const skip = (await dbSkipReason()) || (await redisSkipReason());

async function rawCatalog(orgId: string, names: string[], status: 'uploaded' | 'analyzing' = 'uploaded') {
  const catalog = await db.catalog.create({
    data: {
      orgId, filename: 'worker.xlsx', rowCount: names.length, status,
      headers: ['name', 'mxik'], columnMap: { name: 0, barcode: -1, mxik: 1, unit: -1, price: -1 },
    },
  });
  await db.catalogItem.createMany({
    data: names.map((name, rowIndex) => ({ catalogId: catalog.id, rowIndex, rawName: name, normalizedName: '', existingMxik: null, attrs: { original: [name, ''] } })),
  });
  return catalog.id;
}

async function waitFor(catalogId: string, status: 'ready' | 'failed', timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const c = await db.catalog.findUnique({ where: { id: catalogId }, select: { status: true, auditError: true } });
    // "ready" is written before the audit event; the job is done once both are there.
    const done = c?.status === status
      && (status === 'failed' || (await db.auditEvent.count({ where: { targetId: catalogId, action: 'catalog.audited' } })) > 0);
    if (done) return;
    if (Date.now() > deadline) throw new Error(`catalogue still ${c?.status}: ${c?.auditError ?? ''}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe('worker (Redis + database)', { skip, timeout: 600_000 }, () => {
  const prefix = `tasnivo-worker-test-${process.pid}-${Date.now()}`;
  let app: INestApplicationContext | null = null;
  let a: TestActor;

  before(async () => {
    a = await makeOrg();
    app = await startWorker({ redisUrl: REDIS, auditConcurrency: 1, port: 0, shutdownGraceMs: 120_000, prefix }, { schedule: false, logger: false });
  });
  after(async () => {
    if (app) await stopWorker(app, 5_000);
    await dropOrgs([a.orgId]);
    const admin = new Redis(REDIS);
    const keys = await admin.keys(`${prefix}:*`);
    if (keys.length > 0) await admin.del(...keys);
    admin.disconnect();
    await db.$disconnect();
  });

  it('puts the domain on the queues: startAudit queues, the worker audits to "ready"', async () => {
    assert.equal(jobs().mode, 'bullmq');
    const id = await rawCatalog(a.orgId, ['Kartoshka', 'Guruch']);
    await startAudit(id, a, { via: 'test' });
    await waitFor(id, 'ready');
    const catalog = await db.catalog.findUnique({ where: { id }, select: { progressDone: true } });
    assert.equal(catalog?.progressDone, 2);
    const event = await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'catalog.audited', targetId: id }, select: { payload: true } });
    assert.equal((event?.payload as { via?: string } | null)?.via, 'test');
  });

  it('resumes an orphaned audit from its watermark through the queue', async () => {
    const id = await rawCatalog(a.orgId, ['Kartoshka', 'Shakar'], 'analyzing');
    await db.catalog.update({ where: { id }, data: { progressDone: 1, auditHeartbeatAt: new Date(Date.now() - 10 * 60_000) } });
    const items = await db.catalogItem.findMany({ where: { catalogId: id }, orderBy: { rowIndex: 'asc' } });
    const kept = await db.finding.create({ data: { itemId: items[0]?.id ?? '', type: 'MISSING', severity: 'high', alternatives: [], reason: 'before crash' } });
    await db.finding.create({ data: { itemId: items[1]?.id ?? '', type: 'MISMATCH', severity: 'medium', alternatives: [], reason: 'half-written' } });

    assert.equal(await resumeStaleAudits(0, id), 1);
    await waitFor(id, 'ready');
    assert.ok(await db.finding.findUnique({ where: { id: kept.id } }), 'finished rows are not redone');
    const row1 = await db.finding.findMany({ where: { itemId: items[1]?.id ?? '' } });
    assert.deepEqual(row1.map((f) => f.type), ['MISSING']);
  });

  it('on shutdown takes no new job but finishes the running audit', async () => {
    const id = await rawCatalog(a.orgId, Array.from({ length: 24 }, (_, i) => `Mahsulot ${i} kartoshka guruch`));
    await startAudit(id, a);
    // Wait until the worker has the audit (its heartbeat is newer than the start).
    const startedAt = Date.now();
    for (;;) {
      const c = await db.catalog.findUnique({ where: { id }, select: { progressDone: true, auditHeartbeatAt: true } });
      if ((c?.auditHeartbeatAt?.getTime() ?? 0) > startedAt) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const running = app;
    app = null;
    assert.ok(running);
    assert.equal(await stopWorker(running, 120_000), true, 'stopped within the grace period');
    const after = await db.catalog.findUnique({ where: { id }, select: { status: true, progressDone: true } });
    assert.equal(after?.status, 'ready');
    assert.equal(after?.progressDone, 24);
  });
});
