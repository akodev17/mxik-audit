import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { makeClient, makeClientCatalog, makePerson, type Person } from './firm-test-fixtures.js';
import { onboardingSteps, type Step } from './onboarding.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

const step = (steps: Step[], key: Step['key']): Step | undefined => steps.find((s) => s.key === key);
const viewer = (p: Person) => ({ orgId: p.orgId, userId: p.userId, role: p.role, demo: false, clientIds: p.clientIds });

describe('first-run checklist counts only what the user may open (database)', { skip }, () => {
  let org: TestActor;
  let admin: Person;
  let reviewed = '';
  let untouched = '';

  before(async () => {
    org = await makeOrg();
    admin = await makePerson(org.orgId, 'admin');
    reviewed = await makeClient(org.orgId, 'Koʻrilgan');
    untouched = await makeClient(org.orgId, 'Tegilmagan');
    const { catalogId } = await makeClientCatalog(org.orgId, reviewed, [{ name: 'Guruch', findings: [{ severity: 'high' }] }]);
    await db.auditEvent.create({ data: { orgId: org.orgId, actorId: admin.userId, action: 'finding.accepted', targetId: 'f', payload: { catalogId } } });
  });
  after(async () => {
    await dropOrgs([org.orgId]);
    await db.$disconnect();
  });

  it('a decision on another client does not tick a scoped accountant’s review or upload step', async () => {
    const elsewhere = await makePerson(org.orgId, 'accountant', [untouched]);
    const steps = await onboardingSteps(viewer(elsewhere));
    assert.equal(step(steps, 'client')?.done, true, 'their own client counts');
    assert.equal(step(steps, 'upload')?.done, false);
    assert.equal(step(steps, 'review')?.done, false);
  });

  it('the same decision counts for the accountant of that client and for the admin', async () => {
    const here = await makePerson(org.orgId, 'accountant', [reviewed]);
    assert.equal(step(await onboardingSteps(viewer(here)), 'review')?.done, true);
    assert.equal(step(await onboardingSteps(viewer(admin)), 'review')?.done, true);
  });

  it('links to the settings tabs that exist', async () => {
    const steps = await onboardingSteps(viewer(admin));
    assert.equal(step(steps, 'invite')?.href, '/team');
    assert.equal(step(steps, 'twoFactor')?.href, '/settings?tab=security');
    const telegram = step(steps, 'telegram');
    if (telegram) assert.equal(telegram.href, '/settings?tab=integrations');
  });
});
