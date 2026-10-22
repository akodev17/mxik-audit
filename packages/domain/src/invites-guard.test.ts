import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { makeClient, makePerson } from './firm-test-fixtures.js';
import { createInvite, InviteRefused, type InviteRefusal } from './invites.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

const refused = (reason: InviteRefusal) => (error: unknown): boolean => error instanceof InviteRefused && error.reason === reason;

describe('createInvite refuses on its own, whatever the caller checked (database)', { skip }, () => {
  let a: TestActor;
  let other: TestActor;
  let active = '';
  let archived = '';
  let foreign = '';
  const orgs: string[] = [];

  before(async () => {
    a = await makeOrg();
    other = await makeOrg();
    orgs.push(a.orgId, other.orgId);
    active = await makeClient(a.orgId, 'invite-active');
    archived = await makeClient(a.orgId, 'invite-archived', { archived: true });
    foreign = await makeClient(other.orgId, 'invite-foreign');
  });
  after(async () => {
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  const invitesOf = (orgId: string) => db.invite.count({ where: { orgId } });

  it('refuses a non-admin, and an admin of another org', async () => {
    const accountant = await makePerson(a.orgId, 'accountant');
    const viewer = await makePerson(a.orgId, 'viewer');
    const input = { email: null, role: 'viewer' as const, clientIds: [] };
    await assert.rejects(createInvite(accountant, input), refused('forbidden'));
    await assert.rejects(createInvite(viewer, input), refused('forbidden'));
    await assert.rejects(createInvite({ orgId: a.orgId, userId: other.userId }, input), refused('forbidden'));
    assert.equal(await invitesOf(a.orgId), 0);
  });

  it('refuses a demo org', async () => {
    const demo = await makeOrg('demo', new Date(Date.now() + 3_600_000));
    orgs.push(demo.orgId);
    await assert.rejects(createInvite(demo, { email: null, role: 'viewer', clientIds: [] }), refused('demo'));
    assert.equal(await invitesOf(demo.orgId), 0);
  });

  it('refuses archived and other-org clients instead of dropping them', async () => {
    for (const clientIds of [[archived], [foreign], [active, archived], [active, foreign]]) {
      await assert.rejects(createInvite(a, { email: null, role: 'accountant', clientIds }), refused('bad_clients'));
    }
    assert.equal(await invitesOf(a.orgId), 0);
  });

  it('stores the active clients of the org', async () => {
    await createInvite(a, { email: null, role: 'accountant', clientIds: [active, active] });
    const invite = await db.invite.findFirstOrThrow({ where: { orgId: a.orgId }, select: { clientIds: true, createdBy: true } });
    assert.deepEqual(invite.clientIds, [active]);
    assert.equal(invite.createdBy, a.userId);
  });
});
