import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from '../test-fixtures.js';
import { createRecord, endRecord, isLive, listSessions, recordAccepted, SESSION_MAX_AGE_SECONDS } from './session-store.js';

const skip = await dbSkipReason();
const DAY = 86_400_000;

describe('session records (database)', { skip }, () => {
  let a: TestActor;
  before(async () => { a = await makeOrg(); });
  after(async () => {
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  it('the cookie lifetime is seven days', () => {
    assert.equal(SESSION_MAX_AGE_SECONDS, 7 * 24 * 3600);
  });

  it('a record not seen for longer than the cookie lifetime is dead and not listed', async () => {
    const fresh = await createRecord(a.userId, a.orgId, 'fresh');
    const stale = await createRecord(a.userId, a.orgId, 'stale');
    await db.userSession.update({ where: { id: stale }, data: { lastSeenAt: new Date(Date.now() - 8 * DAY) } });
    assert.equal(await isLive(fresh, a.userId), true);
    assert.equal(await isLive(stale, a.userId), false);
    const listed = (await listSessions(a.userId)).map((s) => s.id);
    assert.ok(listed.includes(fresh));
    assert.ok(!listed.includes(stale));
  });

  it('a record seen six days ago is still live and gets its last-seen refreshed', async () => {
    const sid = await createRecord(a.userId, a.orgId, 'older');
    await db.userSession.update({ where: { id: sid }, data: { lastSeenAt: new Date(Date.now() - 6 * DAY) } });
    assert.equal(await isLive(sid, a.userId), true);
    const row = await db.userSession.findUniqueOrThrow({ where: { id: sid } });
    assert.ok(Date.now() - row.lastSeenAt.getTime() < 60_000);
  });

  it('an ended record, or another user’s, is not live', async () => {
    const sid = await createRecord(a.userId, a.orgId, 'ended');
    assert.equal(await isLive(sid, 'someone-else'), false);
    await endRecord(sid);
    assert.equal(await isLive(sid, a.userId), false);
  });

  it('a cookie without a record is accepted for no one, a demo included', async () => {
    assert.equal(await recordAccepted(undefined, a.userId, false), false);
    assert.equal(await recordAccepted(undefined, a.userId, true), false);
    const sid = await createRecord(a.userId, a.orgId, 'with record');
    assert.equal(await recordAccepted(sid, a.userId, false), true);
  });
});
