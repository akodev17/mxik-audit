import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { makePerson } from '../firm-test-fixtures.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from '../test-fixtures.js';
import { consumeLinkCode, createLinkCode, linkForChat, unlink } from './linking.js';

const skip = await dbSkipReason();
const chat = (): string => `-300${Date.now()}${randomBytes(3).readUIntBE(0, 3)}`;

describe('Telegram linking is an admin feature (database)', { skip }, () => {
  let a: TestActor;
  const orgs: string[] = [];

  before(async () => {
    a = await makeOrg();
    orgs.push(a.orgId);
  });
  after(async () => {
    await db.telegramLinkCode.deleteMany({ where: { orgId: { in: orgs } } });
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('only an admin gets a link code', async () => {
    const accountant = await makePerson(a.orgId, 'accountant');
    const viewer = await makePerson(a.orgId, 'viewer');
    await assert.rejects(createLinkCode(accountant));
    await assert.rejects(createLinkCode(viewer));
    const other = await makeOrg();
    orgs.push(other.orgId);
    // An admin of another org cannot issue a code for this one.
    await assert.rejects(createLinkCode({ orgId: a.orgId, userId: other.userId }));
    assert.equal(await db.telegramLinkCode.count({ where: { orgId: a.orgId } }), 0);
    assert.match((await createLinkCode(a)).code, /^[A-Z0-9]{8}$/);
  });

  it('only an admin of the org unlinks a chat', async () => {
    const chatId = chat();
    const { code } = await createLinkCode(a);
    assert.equal((await consumeLinkCode(code, chatId, null)).ok, true);
    const link = await db.telegramLink.findUniqueOrThrow({ where: { chatId }, select: { id: true } });
    const accountant = await makePerson(a.orgId, 'accountant');
    assert.equal(await unlink(accountant, link.id), false);
    assert.notEqual(await linkForChat(chatId), null);
    assert.equal(await unlink(a, link.id), true);
    assert.equal(await linkForChat(chatId), null);
  });

  it('a code whose admin was demoted meanwhile links nothing', async () => {
    const admin = await makePerson(a.orgId, 'admin');
    const { code } = await createLinkCode(admin);
    // Straight in the database: changeMember would also drop the code.
    await db.user.update({ where: { id: admin.userId }, data: { role: 'accountant' } });
    const chatId = chat();
    assert.deepEqual(await consumeLinkCode(code, chatId, null), { ok: false, reason: 'invalid' });
    assert.equal(await db.telegramLink.count({ where: { chatId } }), 0);
  });

  it('a code whose admin was removed meanwhile links nothing', async () => {
    const admin = await makePerson(a.orgId, 'admin');
    const { code } = await createLinkCode(admin);
    await db.user.delete({ where: { id: admin.userId } });
    const chatId = chat();
    assert.deepEqual(await consumeLinkCode(code, chatId, null), { ok: false, reason: 'invalid' });
    assert.equal(await db.telegramLink.count({ where: { chatId } }), 0);
  });

  it('a code of a closed account links nothing', async () => {
    const closed = await makeOrg();
    orgs.push(closed.orgId);
    const { code } = await createLinkCode(closed);
    await db.organization.update({ where: { id: closed.orgId }, data: { deletedAt: new Date() } });
    assert.deepEqual(await consumeLinkCode(code, chat(), null), { ok: false, reason: 'invalid' });
  });

  it('a chat stops working once whoever linked it is no longer an admin of the org', async () => {
    const admin = await makePerson(a.orgId, 'admin');
    const demoted = chat();
    const removed = chat();
    const orphan = chat();
    for (const chatId of [demoted, removed]) {
      const { code } = await createLinkCode(admin);
      assert.equal((await consumeLinkCode(code, chatId, null)).ok, true);
    }
    assert.deepEqual(await linkForChat(demoted), { orgId: a.orgId, linkedBy: admin.userId });

    // Demoted outside changeMember (which would unlink): the link is refused anyway.
    await db.user.update({ where: { id: admin.userId }, data: { role: 'viewer' } });
    assert.equal(await linkForChat(demoted), null);
    await db.user.update({ where: { id: admin.userId }, data: { role: 'admin' } });
    assert.notEqual(await linkForChat(demoted), null);

    // The linker gone, or never recorded.
    await db.telegramLink.update({ where: { chatId: removed }, data: { linkedBy: 'no-such-user' } });
    assert.equal(await linkForChat(removed), null);
    await db.telegramLink.create({ data: { orgId: a.orgId, chatId: orphan, linkedBy: null } });
    assert.equal(await linkForChat(orphan), null);
  });
});
