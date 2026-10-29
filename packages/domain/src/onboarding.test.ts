import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { makeClient, makeClientCatalog, makePerson, type Person } from './firm-test-fixtures.js';
import { checklistHidden, checklistOpen, onboardingSteps, setChecklistHidden, type Step } from './onboarding.js';
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

  it('the export step comes after review, leads to the newest audited catalogue and ticks on a delivery in scope', async () => {
    const keys = (await onboardingSteps(viewer(admin))).map((s) => s.key);
    assert.equal(keys.indexOf('export'), keys.indexOf('review') + 1);
    const here = await makePerson(org.orgId, 'accountant', [reviewed]);
    const elsewhere = await makePerson(org.orgId, 'accountant', [untouched]);
    const before = step(await onboardingSteps(viewer(here)), 'export');
    assert.equal(before?.done, false);
    assert.match(before?.href ?? '', /^\/catalogs\/[a-z0-9]+$/);
    assert.equal(step(await onboardingSteps(viewer(elsewhere)), 'export')?.href, '/catalogs', 'no audited catalogue of their own');

    const catalog = await db.catalog.findFirstOrThrow({ where: { clientId: reviewed }, select: { id: true } });
    await db.auditEvent.create({ data: { orgId: org.orgId, actorId: admin.userId, action: 'share.created', targetId: 'l', payload: { catalogId: catalog.id } } });
    assert.equal(step(await onboardingSteps(viewer(here)), 'export')?.done, true);
    assert.equal(step(await onboardingSteps(viewer(admin)), 'export')?.done, true);
    assert.equal(step(await onboardingSteps(viewer(elsewhere)), 'export')?.done, false, 'another client\'s link does not count');
  });

  it('security and Telegram are optional: undone, they do not keep the checklist open', async () => {
    const steps = await onboardingSteps(viewer(admin));
    assert.equal(step(steps, 'twoFactor')?.optional, true);
    assert.ok(steps.filter((s) => s.key !== 'twoFactor' && s.key !== 'telegram').every((s) => !s.optional));
    // By now the admin has a client, an upload, a decision, the link above and colleagues, but no second factor.
    assert.deepEqual(steps.filter((s) => !s.done).map((s) => s.key).filter((k) => k !== 'telegram'), ['twoFactor']);
    assert.equal(checklistOpen(steps), false);
    // Undo one required step's evidence: the checklist is open again.
    await db.auditEvent.deleteMany({ where: { orgId: org.orgId, action: 'share.created' } });
    assert.equal(checklistOpen(await onboardingSteps(viewer(admin))), true);
  });

  it('hiding is saved per person; a demo visitor\'s choice is not', async () => {
    assert.equal(await checklistHidden(admin.userId), false);
    await setChecklistHidden({ userId: admin.userId, demo: false }, true);
    assert.equal(await checklistHidden(admin.userId), true);
    await setChecklistHidden({ userId: admin.userId, demo: false }, false);
    assert.equal(await checklistHidden(admin.userId), false);
    await setChecklistHidden({ userId: admin.userId, demo: true }, true);
    assert.equal(await checklistHidden(admin.userId), false);
  });
});

describe('checklist completion rule', () => {
  it('open while a required step is left; optional steps never count', () => {
    assert.equal(checklistOpen([]), false);
    assert.equal(checklistOpen([{ done: true, optional: false }, { done: false, optional: true }]), false);
    assert.equal(checklistOpen([{ done: false, optional: false }, { done: true, optional: true }]), true);
  });
});
