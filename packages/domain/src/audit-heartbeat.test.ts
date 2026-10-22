import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HEARTBEAT_MS, startHeartbeat } from './audit-heartbeat.js';
import { db } from '@tasnivo/db';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

describe('audit heartbeat (database)', { skip }, () => {
  let org: TestActor;
  before(async () => { org = await makeOrg(); });
  after(async () => {
    await dropOrgs([org.orgId]);
    await db.$disconnect();
  });

  it('beats at once, then on a timer even when no row finishes', async () => {
    const { id } = await db.catalog.create({
      data: { orgId: org.orgId, filename: 'beat.xlsx', rowCount: 10, status: 'analyzing', headers: [], columnMap: {} },
    });
    const read = () => db.catalog.findUniqueOrThrow({ where: { id }, select: { auditHeartbeatAt: true, progressDone: true } });

    const heartbeat = await startHeartbeat(id, 3);
    const first = await read();
    assert.ok(first.auditHeartbeatAt);
    assert.equal(first.progressDone, 3);

    heartbeat.mark(7);
    await new Promise((r) => setTimeout(r, HEARTBEAT_MS + 500));
    heartbeat.stop();
    const later = await read();
    assert.ok(later.auditHeartbeatAt && later.auditHeartbeatAt > first.auditHeartbeatAt);
    assert.equal(later.progressDone, 7);
  });
});
