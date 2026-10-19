import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from './db.js';
import { listNotifications, markAllRead, markRead, noticeHref, unreadCount, type NoticeUser } from './notifications.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

describe('notification links', () => {
  it('sends legacy report links straight to the catalogue', () => {
    assert.equal(noticeHref('/report?catalog=ck123'), '/catalogs/ck123');
    assert.equal(noticeHref('/report?catalog=ck123&marking=1'), '/catalogs/ck123?type=MARKING');
    assert.equal(noticeHref('/report?catalog=ck123&type=NOT_FOUND'), '/catalogs/ck123?type=NOT_FOUND');
    assert.equal(noticeHref('/report'), '/catalogs');
  });

  it('keeps site-relative links and drops everything else', () => {
    assert.equal(noticeHref('/clients/abc'), '/clients/abc');
    assert.equal(noticeHref('/catalogs/abc?type=MISSING'), '/catalogs/abc?type=MISSING');
    assert.equal(noticeHref('//evil.example/x'), null);
    assert.equal(noticeHref('/\\evil.example'), null);
    assert.equal(noticeHref('https://evil.example'), null);
    assert.equal(noticeHref(null), null);
  });

  it('judges the link the way a browser reads it: control characters and backslashes do not hide a host', () => {
    assert.equal(noticeHref('/\t/evil.example'), null);
    assert.equal(noticeHref('/\n/evil.example/x'), null);
    assert.equal(noticeHref(' //evil.example'), null);
    assert.equal(noticeHref('\u0000/\\evil.example'), null);
    assert.equal(noticeHref('/.//evil.example'), null);
    assert.equal(noticeHref('javascript:alert(1)'), null);
    assert.equal(noticeHref('\tjavascript:alert(1)'), null);
    assert.equal(noticeHref('/%2F%2Fevil'), '/%2F%2Fevil', 'an encoded slash stays part of a same-site path');
    assert.equal(noticeHref('/catalogs/ck1\t?type=MISSING#row'), '/catalogs/ck1?type=MISSING#row');
  });
});

const skip = await dbSkipReason();

describe('notifications per user and scope (database)', { skip }, () => {
  let a: TestActor;
  let b: TestActor;
  let admin: NoticeUser;
  let accountant: NoticeUser;
  const n = { org: '', c1: '', c2: '', legacy: '', other: '' };

  before(async () => {
    a = await makeOrg();
    b = await makeOrg();
    const tag = randomBytes(4).toString('hex');
    const c1 = await db.client.create({ data: { orgId: a.orgId, name: `Bir ${tag}` } });
    const c2 = await db.client.create({ data: { orgId: a.orgId, name: `Ikki ${tag}` } });
    const acc = await db.user.create({ data: { orgId: a.orgId, email: `test-${tag}-acc@test.local`, passwordHash: 'x', role: 'accountant' } });
    await db.clientAssignment.create({ data: { userId: acc.id, clientId: c2.id } });
    admin = { userId: a.userId, orgId: a.orgId, clientIds: null };
    accountant = { userId: acc.id, orgId: a.orgId, clientIds: [c2.id] };
    const make = async (orgId: string, clientId: string | null, minutesAgo: number, readAt: Date | null = null): Promise<string> =>
      (await db.notification.create({
        data: { orgId, clientId, kind: 'test', title: `t-${minutesAgo}`, body: 'b', href: '/report?catalog=x', readAt, createdAt: new Date(Date.now() - minutesAgo * 60_000) },
      })).id;
    n.org = await make(a.orgId, null, 1);
    n.c1 = await make(a.orgId, c1.id, 2);
    n.c2 = await make(a.orgId, c2.id, 3);
    n.legacy = await make(a.orgId, null, 4, new Date());
    n.other = await make(b.orgId, null, 5);
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  it('shows org-level notices to everyone and client notices only within the user\'s clients', async () => {
    const all = await listNotifications(admin);
    assert.deepEqual(all.items.map((x) => x.id), [n.org, n.c1, n.c2, n.legacy]);
    const mine = await listNotifications(accountant);
    assert.deepEqual(mine.items.map((x) => x.id), [n.org, n.c2, n.legacy]);
    assert.ok(!mine.items.some((x) => x.id === n.other));
    assert.equal(all.items[0]?.href, '/catalogs/x');
  });

  it('counts unread per user; the old org-wide read flag still counts as read', async () => {
    assert.equal(await unreadCount(admin), 3);
    assert.equal(await unreadCount(accountant), 2);
    const legacy = (await listNotifications(admin)).items.find((x) => x.id === n.legacy);
    assert.equal(legacy?.unread, false);
  });

  it('listing never marks anything read', async () => {
    await listNotifications(accountant);
    await listNotifications(accountant, { unreadOnly: true });
    assert.equal(await unreadCount(accountant), 2);
  });

  it('marks only notices in the user\'s scope, and only for that user', async () => {
    const marked = await markRead(accountant, [n.c1, n.c2, n.other, 'missing']);
    assert.equal(marked, 1);
    assert.equal(await unreadCount(accountant), 1);
    assert.equal(await unreadCount(admin), 3);
    assert.equal(await db.notificationRead.count({ where: { userId: accountant.userId, notificationId: { in: [n.c1, n.other] } } }), 0);
    const again = await markRead(accountant, [n.c2]);
    assert.equal(again, 1, 'marking twice is harmless');
  });

  it('marks all read for one user without touching anyone else', async () => {
    assert.equal(await markAllRead(accountant), 1);
    assert.equal(await unreadCount(accountant), 0);
    assert.equal(await unreadCount(admin), 3);
    const unreadOnly = await listNotifications(accountant, { unreadOnly: true });
    assert.equal(unreadOnly.total, 0);
    assert.equal(await markAllRead(accountant), 0);
  });

  it('paginates newest first', async () => {
    const first = await listNotifications(admin, { pageSize: 3 });
    assert.equal(first.total, 4);
    assert.equal(first.pageCount, 2);
    assert.equal(first.items.length, 3);
    const second = await listNotifications(admin, { pageSize: 3, page: 1 });
    assert.deepEqual(second.items.map((x) => x.id), [n.legacy]);
  });
});
