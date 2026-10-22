import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { isPlatformAdmin, platformAdminAllowed } from './admin.js';
import { db } from './db.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();
const env = { ADMIN_EMAILS: 'owner@example.uz' };
const owner = { platformAdmin: true, email: 'owner@example.uz', emailVerifiedAt: new Date() };

describe('platformAdminAllowed', () => {
  it('needs the database flag, an ADMIN_EMAILS address and a confirmed address together', () => {
    assert.equal(platformAdminAllowed(owner, env), true);
    assert.equal(platformAdminAllowed({ ...owner, platformAdmin: false }, env), false);
    assert.equal(platformAdminAllowed({ ...owner, emailVerifiedAt: null }, env), false);
    assert.equal(platformAdminAllowed({ ...owner, email: 'someone@example.uz' }, env), false);
    assert.equal(platformAdminAllowed(owner, {}), false);
    assert.equal(platformAdminAllowed(null, env), false);
  });
});

describe('isPlatformAdmin (database)', { skip }, () => {
  let a: TestActor;
  before(async () => { a = await makeOrg(); });
  after(async () => {
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  it('an address typed into an e-mail-less invite is not enough', async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: a.userId } });
    const listed = { ADMIN_EMAILS: user.email };
    assert.equal(await isPlatformAdmin(a.userId, listed), false);
    await db.user.update({ where: { id: a.userId }, data: { emailVerifiedAt: new Date() } });
    assert.equal(await isPlatformAdmin(a.userId, listed), false, 'no flag');
    await db.user.update({ where: { id: a.userId }, data: { platformAdmin: true } });
    assert.equal(await isPlatformAdmin(a.userId, listed), true);
  });
});
