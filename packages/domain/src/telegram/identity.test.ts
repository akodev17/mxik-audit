import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { telegramEmail } from '../security/reserved-email.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from '../test-fixtures.js';
import { bindTelegram, loginTarget, telegramBinding, unbindTelegram } from './identity.js';

const skip = await dbSkipReason();
// Real Telegram user ids are positive; these stay clear of any real chat in a dev database.
const newId = (): string => String(8_000_000_000 + Math.floor(Math.random() * 1_000_000_000));

describe('Telegram sign-in identity (database)', { skip }, () => {
  let a: TestActor;
  let member: TestActor;
  const orgs: string[] = [];

  before(async () => {
    a = await makeOrg();
    member = { orgId: a.orgId, userId: (await db.user.create({ data: { orgId: a.orgId, email: `test-member-${newId()}@test.local`, passwordHash: 'x', role: 'accountant' } })).id };
    orgs.push(a.orgId);
  });
  after(async () => {
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('a notification chat linked by an admin does not sign anyone in', async () => {
    const chatId = newId();
    await db.telegramLink.create({ data: { orgId: a.orgId, chatId, linkedBy: a.userId } });
    assert.deepEqual(await loginTarget(chatId), { kind: 'unbound' });
  });

  it('signs in exactly the user who bound the id', async () => {
    const id = newId();
    assert.equal(await bindTelegram(member, id), 'bound');
    const target = await loginTarget(id);
    assert.equal(target.kind === 'user' ? target.user.id : null, member.userId);
    assert.ok(await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'security.telegram_bound', actorId: member.userId } }));
  });

  it('a removed member no longer signs in to the org through Telegram', async () => {
    const id = newId();
    const removed = await db.user.create({ data: { orgId: a.orgId, email: `test-gone-${id}@test.local`, passwordHash: 'x', role: 'accountant' } });
    await bindTelegram({ userId: removed.id, orgId: a.orgId }, id);
    // Their private chat was also linked for the org's notifications.
    await db.telegramLink.create({ data: { orgId: a.orgId, chatId: id, linkedBy: removed.id } });
    await db.user.delete({ where: { id: removed.id } });
    assert.deepEqual(await loginTarget(id), { kind: 'unbound' });
  });

  it('a removed member without a linked chat is treated as a stranger, never as someone in the org', async () => {
    const id = newId();
    const removed = await db.user.create({ data: { orgId: a.orgId, email: `test-gone-${id}@test.local`, passwordHash: 'x', role: 'viewer' } });
    await bindTelegram({ userId: removed.id, orgId: a.orgId }, id);
    await db.user.delete({ where: { id: removed.id } });
    assert.deepEqual(await loginTarget(id), { kind: 'new' });
  });

  it('an id that is bound elsewhere cannot be bound again', async () => {
    const id = newId();
    assert.equal(await bindTelegram(member, id), 'bound');
    assert.equal(await bindTelegram(a, id), 'taken');
  });

  it('unbinding ends the Telegram sign-in', async () => {
    const id = newId();
    const person = await db.user.create({ data: { orgId: a.orgId, email: `test-${id}@example.uz`, passwordHash: 'x' } });
    const actor = { userId: person.id, orgId: a.orgId };
    await bindTelegram(actor, id);
    assert.deepEqual(await telegramBinding(person.id), { bound: true, canUnbind: true });
    assert.equal(await unbindTelegram(actor), true);
    assert.deepEqual(await loginTarget(id), { kind: 'new' });
    assert.equal((await telegramBinding(person.id)).bound, false);
  });

  it('an account opened with Telegram before bindings existed is recognised and bound on first use', async () => {
    const id = newId();
    const org = await db.organization.create({ data: { name: `test-${id}`, kind: 'customer' } });
    orgs.push(org.id);
    const user = await db.user.create({ data: { orgId: org.id, email: telegramEmail(id), passwordHash: 'x', emailVerifiedAt: new Date() } });
    await db.auditEvent.create({ data: { orgId: org.id, actorId: user.id, action: 'account.created', payload: { via: 'telegram' } } });
    const target = await loginTarget(id);
    assert.equal(target.kind === 'user' ? target.user.id : null, user.id);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).telegramUserId, id);
    // Such an account has no other way in, so its binding cannot be removed.
    assert.deepEqual(await telegramBinding(user.id), { bound: true, canUnbind: false });
    assert.equal(await unbindTelegram({ userId: user.id, orgId: org.id }), false);
  });

  it('a placeholder address made through signup (no Telegram event) is not trusted', async () => {
    const id = newId();
    const org = await db.organization.create({ data: { name: `test-${id}`, kind: 'customer' } });
    orgs.push(org.id);
    const user = await db.user.create({ data: { orgId: org.id, email: telegramEmail(id), passwordHash: 'x' } });
    await db.auditEvent.create({ data: { orgId: org.id, actorId: user.id, action: 'account.created', payload: { via: 'signup' } } });
    assert.deepEqual(await loginTarget(id), { kind: 'new' });
  });
});
