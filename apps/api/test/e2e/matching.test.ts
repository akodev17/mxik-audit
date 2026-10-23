// Q1: the API process shares one embedding provider across checks, inline audits and doc checks.
// Before the fix audit-runner built a fresh provider per auditContext() call in the API, so a local
// model loaded its ~470 MB of weights per /api/v1/check and a burst of checks crashed the process.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { db } from '@tasnivo/db';
import { auditContext, vectorReadiness } from '@tasnivo/domain/audit-runner';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from '@tasnivo/domain/test-fixtures';
import { EmbedderService } from '../../src/matching/embedder.service';
import { startApp } from '../helpers';

const skip = await dbSkipReason();

describe('shared embedder in the API process (Q1, database)', { skip }, () => {
  let app: INestApplication;
  let org: TestActor;

  before(async () => {
    app = await startApp();
    org = await makeOrg();
  });
  after(async () => {
    await dropOrgs([org.orgId]);
    await db.$disconnect();
  });

  it('auditContext() twice gives the same embedder instance while the app runs', async () => {
    const first = await auditContext(org.orgId);
    const second = await auditContext(org.orgId);
    assert.equal(first.embedder, second.embedder);
    assert.equal((await vectorReadiness()).embedder, first.embedder);
    assert.ok(app.get(EmbedderService).embedders().includes(first.embedder.name));
  });

  it('20 parallel contexts share one provider', async () => {
    const contexts = await Promise.all(Array.from({ length: 20 }, () => auditContext(org.orgId)));
    assert.equal(new Set(contexts.map((c) => c.embedder)).size, 1);
  });

  it('closing the app restores the per-call default (scripts, tests)', async () => {
    await app.close();
    const a = await vectorReadiness();
    const b = await vectorReadiness();
    assert.notEqual(a.embedder, b.embedder);
  });
});
