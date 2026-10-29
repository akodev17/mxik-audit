import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';
import { isAuditRunning, resumeStaleAudits, retryAudit, runAudit, startAudit, STARTUP_STALE_MS } from './audit-jobs.js';
import { auditCatalog, injectRowFault } from './audit-runner.js';
import { db } from '@tasnivo/db';
import { setJobs } from './jobs/dispatcher.js';
import { InlineDispatcher } from './jobs/inline.js';
import { buildPipelineMeta, readPipelineMeta } from './pipeline-meta.js';
import { setRowRetryDelays } from './row-retry.js';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg, type TestActor } from './test-fixtures.js';
import { workspaceFailedRows, workspaceSummary } from './workspace.js';

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
    // These audits run in this process whatever JOBS_MODE the environment sets.
    setJobs(new InlineDispatcher());
    // The retries' waits, shortened: what is tested is that they happen, not how long they take.
    setRowRetryDelays([10, 10, 10]);
    code = (await liveCodes(1))[0] ?? '';
    a = await makeOrg();
    b = await makeOrg();
  });
  after(async () => {
    setJobs(null);
    setRowRetryDelays(null);
    injectRowFault(null);
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
    // Informational findings (e.g. a privilege-linked suggestion) may come on top.
    const types = (await db.finding.findMany({ where: { item: { catalogId: id }, severity: { not: 'info' } }, select: { type: true } })).map((f) => f.type).sort();
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

  it('stops quietly, without an error in the log, when the catalogue was deleted under the audit', async () => {
    const id = await rawCatalog(a.orgId, [{ name: 'Tuz', code }]);
    await db.catalog.delete({ where: { id } });
    const errors = mock.method(console, 'error', () => undefined);
    const infos = mock.method(console, 'info', () => undefined);
    try {
      await runAudit(id, 0, a, {});
      assert.equal(errors.mock.callCount(), 0);
      assert.match(String(infos.mock.calls[0]?.arguments[0]), /stopped: the catalogue was deleted/);
    } finally {
      errors.mock.restore();
      infos.mock.restore();
    }
  });

  const items = (catalogId: string) => db.catalogItem.findMany({ where: { catalogId }, orderBy: { rowIndex: 'asc' } });
  const metaOf = async (catalogId: string) => readPipelineMeta((await db.catalog.findUnique({ where: { id: catalogId }, select: { pipelineMeta: true } }))?.pipelineMeta);
  const quiet = () => mock.method(console, 'warn', () => undefined);

  it('records a row whose check keeps throwing as not checked and still reaches "ready" with rows_failed', async () => {
    const warn = quiet();
    injectRowFault((item) => { if (item.rawName === 'Buzilgan qator') throw new Error('provider exploded'); });
    try {
      const id = await rawCatalog(a.orgId, [{ name: 'Kartoshka', code: null }, { name: 'Buzilgan qator', code: null }, { name: 'Guruch', code: null }]);
      await startAudit(id, a);
      await waitFor(id, 'ready');
      const [ok, broken] = await items(id);
      assert.equal(broken?.checkError, 'other: provider exploded');
      assert.equal(ok?.checkError, null);
      // Never turned into "ok" by a finding-less pass, and never given a guessed finding either.
      assert.equal(await db.finding.count({ where: { itemId: broken?.id ?? '' } }), 0);
      const meta = await metaOf(id);
      assert.equal(meta?.rowsFailed, 1);
      assert.equal(meta?.rowsAudited, 2);
      assert.ok(meta?.degradedReasons.includes('rows_failed'));
      assert.equal((await workspaceSummary(id, 3)).failedRows, 1);
      assert.deepEqual((await workspaceFailedRows(a, id))?.rows.map((r) => [r.rowIndex, r.kind]), [[1, 'other']]);
      assert.equal(await workspaceFailedRows(b, id), null, 'another org does not see the list');
      // The dev and test databases ship without the restricted list: the run says so instead of looking clean.
      if ((await db.restrictedCode.count()) === 0) assert.ok(meta?.degradedReasons.includes('restricted_unchecked'));
    } finally {
      injectRowFault(null);
      warn.mock.restore();
    }
  });

  it('checks a row that fails and then recovers within its retries as any other row', async () => {
    let throwsLeft = 2;
    injectRowFault((item) => {
      if (item.rawName === 'Kartoshka' && throwsLeft > 0) { throwsLeft--; throw new Error('Timed out fetching a new connection'); }
    });
    try {
      const id = await rawCatalog(a.orgId, [{ name: 'Kartoshka', code: null }]);
      await startAudit(id, a);
      await waitFor(id, 'ready');
      const [row] = await items(id);
      assert.equal(throwsLeft, 0);
      assert.equal(row?.checkError, null);
      assert.deepEqual((await db.finding.findMany({ where: { itemId: row?.id ?? '', severity: { not: 'info' } } })).map((f) => f.type), ['MISSING']);
      assert.equal((await metaOf(id))?.rowsFailed, 0);
    } finally {
      injectRowFault(null);
    }
  });

  it('"re-check failed rows" runs once for concurrent clicks, re-checks only those rows and keeps every decision', async () => {
    const warn = quiet();
    let failing = true;
    injectRowFault((item) => { if (failing && item.rawName === 'Buzilgan qator') throw new Error('canceling statement due to statement timeout'); });
    try {
      const id = await rawCatalog(a.orgId, [{ name: 'Kartoshka', code: null }, { name: 'Buzilgan qator', code: null }]);
      await startAudit(id, a);
      await waitFor(id, 'ready');
      const [first, broken] = await items(id);
      assert.match(broken?.checkError ?? '', /^timeout: /);
      const decided = await db.finding.findFirstOrThrow({ where: { itemId: first?.id ?? '', type: 'MISSING' } });
      await db.finding.update({ where: { id: decided.id }, data: { decision: 'accepted', chosenMxik: decided.suggestedMxik ?? code, decidedBy: a.userId, decidedAt: new Date() } });

      failing = false;
      const claims = await Promise.all([retryAudit(a, id), retryAudit(a, id), retryAudit(a, id)]);
      assert.equal(claims.filter(Boolean).length, 1, 'one claim wins');
      await waitFor(id, 'ready');

      const kept = await db.finding.findUnique({ where: { id: decided.id } });
      assert.equal(kept?.decision, 'accepted', 'the decision on a row that did not fail is kept');
      const [, fixed] = await items(id);
      assert.equal(fixed?.checkError, null);
      assert.deepEqual((await db.finding.findMany({ where: { itemId: fixed?.id ?? '', severity: { not: 'info' } } })).map((f) => f.type), ['MISSING']);
      const meta = await metaOf(id);
      assert.equal(meta?.rowsFailed, 0);
      assert.equal(meta?.rowsAudited, 2, 'the earlier run\'s rows stay counted');
      assert.equal(meta?.degradedReasons.includes('rows_failed'), false);
      assert.equal(await retryAudit(a, id), false, 'nothing left to re-check');
    } finally {
      injectRowFault(null);
      warn.mock.restore();
    }
  });

  it('keeps the counts stored before a crash when an audit resumes', async () => {
    const id = await rawCatalog(a.orgId, [{ name: 'Kartoshka', code: null }, { name: 'Shakar', code: null }], 'analyzing');
    const setup = { embedder: { name: 'x', semantic: true }, vectorUsable: true, reranker: { enabled: true, model: 'm', promptVersion: 'v' } };
    const before = buildPipelineMeta(setup, { rowsAudited: 1, rowsWithoutAi: 1, llmRowsFailed: 0, vectorErrors: 1 }, 0, new Date(), { throughRow: 1 });
    await db.catalog.update({ where: { id }, data: { progressDone: 1, auditHeartbeatAt: new Date(Date.now() - 10 * 60_000), pipelineMeta: before } });
    await resumeStaleAudits(0, id);
    await waitFor(id, 'ready');
    const meta = await metaOf(id);
    assert.equal(meta?.fromRow, 1);
    assert.equal(meta?.rowsAudited, 2);
    assert.ok((meta?.vectorErrors ?? 0) >= 1, 'the vector error from before the crash is kept');
    assert.ok(meta?.degradedReasons.includes('vector_failed'));
  });

  it('keeps beating through the post phase, so the stale sweep leaves a slow one alone', async () => {
    // Rows done (watermark 2), and a pending privilege finding the post phase must delete: holding
    // its row lock keeps the audit in the post phase for as long as this test wants.
    const id = await rawCatalog(a.orgId, [{ name: 'Kartoshka', code: null }, { name: 'Shakar', code: null }], 'analyzing');
    const [row] = await items(id);
    const lockOn = await db.finding.create({ data: { itemId: row?.id ?? '', type: 'PRIVILEGE_CODE', severity: 'info', alternatives: [], reason: 'lock' } });
    await db.catalog.update({ where: { id }, data: { progressDone: 2, auditHeartbeatAt: new Date(Date.now() - 10 * 60_000) } });
    const started = Date.now();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const lock = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM finding WHERE id = ${lockOn.id} FOR UPDATE`;
      await held;
    }, { timeout: 120_000 });
    try {
      await resumeStaleAudits(0, id);
      // The rows phase is over once its final metadata is stored.
      for (;;) {
        const meta = await metaOf(id);
        if (meta && meta.fromRow === 2 && meta.throughRow === 2 && Date.parse(meta.finishedAt) >= started) break;
        if (Date.now() - started > 120_000) throw new Error('rows phase did not finish');
        await new Promise((r) => setTimeout(r, 200));
      }
      await new Promise((r) => setTimeout(r, 5_000));
      const now = await db.catalog.findUnique({ where: { id }, select: { status: true, auditHeartbeatAt: true } });
      assert.equal(now?.status, 'analyzing', 'still in the post phase');
      assert.ok(Date.now() - (now?.auditHeartbeatAt?.getTime() ?? 0) < 4_000, 'the heartbeat is fresh');
      assert.equal(await resumeStaleAudits(4_000, id), 0, 'the sweep does not take it');
    } finally {
      release();
      await lock;
    }
    await waitFor(id, 'ready');
    // The audit event comes after "ready"; wait for it so nothing writes once the suite disconnects.
    while ((await db.auditEvent.count({ where: { targetId: id, action: 'catalog.audited' } })) === 0) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 1_000));
  });
});
