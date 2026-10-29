// Reading a catalogue (its header or its progress) restarts a stalled audit only for a writer and only
// where this process runs audits (JOBS_MODE inline); a viewer's page load never starts work (Q15).
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { catalogHeader, catalogProgress, resumesOnRead } from './catalog-pages.js';
import { makeClient, makeClientCatalog, makePerson } from './firm-test-fixtures.js';
import { setJobs, type JobDispatcher } from './jobs/dispatcher.js';
import type { CurrentUser } from './session.js';
import { dbSkipReason, dropOrgs, makeOrg } from './test-fixtures.js';

describe('resumesOnRead (pure)', () => {
  it('inline mode and a writer only', () => {
    assert.equal(resumesOnRead({ role: 'admin' }, 'inline'), true);
    assert.equal(resumesOnRead({ role: 'accountant' }, 'inline'), true);
    assert.equal(resumesOnRead({ role: 'viewer' }, 'inline'), false);
    assert.equal(resumesOnRead({ role: 'admin' }, 'bullmq'), false, 'the worker’s sweep resumes audits in bullmq mode');
  });
});

const skip = await dbSkipReason();

describe('read paths and stalled audits (database)', { skip }, () => {
  const queued: string[] = [];
  let orgId = '';
  let catalogId = '';
  let admin: CurrentUser;
  let viewer: CurrentUser;
  const savedMode = process.env['JOBS_MODE'];

  before(async () => {
    setJobs({ mode: 'inline', enqueueAudit: (id: string) => { queued.push(id); return Promise.resolve(); } } as unknown as JobDispatcher);
    orgId = (await makeOrg()).orgId;
    const clientId = await makeClient(orgId, 'Mijoz');
    admin = { ...(await makePerson(orgId, 'admin')), demo: false, clientId: null };
    viewer = { ...(await makePerson(orgId, 'viewer')), demo: false, clientId: null };
    catalogId = (await makeClientCatalog(orgId, clientId, [{ name: 'Guruch', findings: [] }])).catalogId;
    // An audit whose worker died: analyzing, no heartbeat.
    await db.catalog.update({ where: { id: catalogId }, data: { status: 'analyzing', auditHeartbeatAt: null } });
  });
  beforeEach(() => { queued.length = 0; process.env['JOBS_MODE'] = 'inline'; });
  after(async () => {
    if (savedMode === undefined) delete process.env['JOBS_MODE'];
    else process.env['JOBS_MODE'] = savedMode;
    setJobs(null);
    await dropOrgs([orgId]);
    await db.$disconnect();
  });

  it('a viewer reads the header and the progress without restarting anything', async () => {
    assert.ok(await catalogHeader(viewer, catalogId));
    assert.ok(await catalogProgress(viewer, catalogId));
    assert.deepEqual(queued, []);
  });

  it('in bullmq mode not even a writer’s read restarts it (the worker sweeps)', async () => {
    process.env['JOBS_MODE'] = 'bullmq';
    assert.ok(await catalogHeader(admin, catalogId));
    assert.ok(await catalogProgress(admin, catalogId));
    assert.deepEqual(queued, []);
  });

  it('inline, a writer’s read hands the stalled audit to the jobs again', async () => {
    assert.ok(await catalogProgress(admin, catalogId));
    assert.deepEqual(queued, [catalogId]);
  });
});
