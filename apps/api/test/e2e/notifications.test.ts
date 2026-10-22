// The notifications module through the real app: the page (paged, unread only, by group), the bell
// preview, marking read for one user only, and the command-palette search; scoping by client, by
// addressee and by org.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { makeClient } from '@tasnivo/domain/firm-test-fixtures';
import { search } from '@tasnivo/domain/search';
import { dbSkipReason, dropOrgs } from '@tasnivo/domain/test-fixtures';
import { serverOf, startApp } from '../helpers';
import { as, member, orgWithAdmin, shaped, type Member } from './workspace-fixtures';

const skip = await dbSkipReason();
const n = endpoints.notifications;

type Page = { items: { id: string; unread: boolean; client: { name: string } | null }[]; total: number; page: number; pageCount: number; unread: number };

describe('notifications module (e2e)', { skip }, () => {
  let app: INestApplication;
  const orgs: string[] = [];
  let admin: Member;
  let accountant: Member;
  let scoped: Member;
  let stranger: Member;
  let clientId: string;
  const ids: string[] = [];
  const http = () => request(serverOf(app));
  const get = (path: string, who: Member) => as(http().get(path), who, false);

  before(async () => {
    app = await startApp();
    admin = await orgWithAdmin(orgs);
    clientId = await makeClient(admin.orgId, 'Sut zavodi');
    const otherClient = await makeClient(admin.orgId, 'Boshqa mijoz');
    accountant = await member(admin.orgId, 'accountant');
    scoped = await member(admin.orgId, 'accountant', [otherClient]);
    stranger = await orgWithAdmin(orgs);
    // 30 org-wide audit notices (two pages of 25), one client notice, one addressed to the accountant only.
    for (let i = 0; i < 30; i += 1) {
      const row = await db.notification.create({
        data: { orgId: admin.orgId, kind: 'catalog.audited', title: `Audit ${i}`, body: 'Tayyor', href: '/catalogs/x', createdAt: new Date(Date.now() - (60 - i) * 60_000) },
      });
      ids.push(row.id);
    }
    await db.notification.create({ data: { orgId: admin.orgId, clientId, kind: 'catalog.audited', title: 'Mijoz audit', body: 'Tayyor' } });
    await db.notification.create({ data: { orgId: admin.orgId, userId: accountant.userId, kind: 'review.assigned', title: 'Sizga', body: 'Koʻrib chiqing' } });
  });

  after(async () => {
    await app?.close();
    await dropOrgs(orgs);
  });

  it('list: pages of 25, newest first, scoped by client and addressee; another org sees nothing', async () => {
    const first = shaped(n.list, (await get('/api/notifications', accountant)).body) as Page;
    assert.equal(first.total, 32);
    assert.equal(first.items.length, 25);
    assert.equal(first.pageCount, 2);
    assert.equal(first.unread, 32);
    const second = shaped(n.list, (await get('/api/notifications?page=1', accountant)).body) as Page;
    assert.equal(second.items.length, 7);
    assert.equal((shaped(n.list, (await get('/api/notifications', admin)).body) as Page).total, 31, 'the personal notice is the accountant\'s');
    assert.equal((shaped(n.list, (await get('/api/notifications', scoped)).body) as Page).total, 30, 'not the other client\'s');
    assert.equal((shaped(n.list, (await get('/api/notifications', stranger)).body) as Page).total, 0);
    const reviews = shaped(n.list, (await get('/api/notifications?group=review&unread=1', accountant)).body) as Page;
    assert.equal(reviews.total, 1);
    assert.equal((await get('/api/notifications?group=nope', accountant)).status, 400);
  });

  it('preview: the latest six and the unread count; reading marks nothing', async () => {
    const bell = shaped(n.preview, (await get('/api/notifications/preview', accountant)).body) as { ok: true; items: unknown[]; unread: number; total: number };
    assert.equal(bell.items.length, 6);
    assert.equal(bell.unread, 32);
    assert.equal(bell.total, 32);
  });

  it('mark read for this user only, then all; another org\'s ids are ignored', async () => {
    const marked = await as(http().post('/api/notifications/read'), accountant).send({ ids: ids.slice(0, 3) });
    assert.deepEqual(shaped(n.markRead, marked.body), { ok: true, unread: 29 });
    assert.equal((shaped(n.list, (await get('/api/notifications', admin)).body) as Page).unread, 31, 'the admin\'s stay unread');
    assert.deepEqual((await as(http().post('/api/notifications/read'), stranger).send({ ids: ids.slice(3, 5) })).body, { ok: true, unread: 0 });
    assert.equal((await as(http().post('/api/notifications/read'), accountant).send({ ids: [] })).status, 400);
    const all = await as(http().post('/api/notifications/read-all'), accountant).send();
    assert.deepEqual(shaped(n.markAllRead, all.body), { ok: true, marked: 29, unread: 0 });
    const unreadOnly = shaped(n.list, (await get('/api/notifications?unread=1', accountant)).body) as Page;
    assert.equal(unreadOnly.total, 0);
  });

  it('search: the palette results the action returned, in the user\'s language and scope', async () => {
    const res = await get(`/api/search?q=${encodeURIComponent('Sut zavodi')}`, admin);
    const body = shaped(n.search, res.body) as { ok: true; results: { clients: { id: string }[] } };
    const expected: unknown = JSON.parse(JSON.stringify(await search({ orgId: admin.orgId, clientIds: null }, 'Sut zavodi', 'uz')));
    assert.deepEqual(res.body, { ok: true, results: expected });
    assert.deepEqual(body.results.clients.map((c) => c.id), [clientId]);
    const hidden = shaped(n.search, (await get(`/api/search?q=${encodeURIComponent('Sut zavodi')}`, scoped)).body) as { results: { clients: unknown[] } };
    assert.deepEqual(hidden.results.clients, []);
    assert.equal((await get(`/api/search?q=${'x'.repeat(201)}`, admin)).status, 400);
    assert.equal((await http().get('/api/search?q=sut')).status, 401);
  });
});
