import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { auditReadyText, inEveryLocale } from './notification-text.js';
import { listNotifications, noticeText, notify } from './notifications.js';
import { dbSkipReason, dropOrgs, makeOrg } from './test-fixtures.js';

describe('notification text per reader language', () => {
  it('B13: picks the reader\'s language from text, and falls back to the stored title and body', () => {
    const text = inEveryLocale((l) => auditReadyText({ clientName: 'Baraka', filename: 'a.xlsx', open: 2 }, l));
    const row = { ...text.uz, text };
    assert.equal(noticeText(row, 'ru').title, 'Проверка готова: Baraka');
    assert.equal(noticeText(row, 'uz').title, 'Tekshiruv tugadi: Baraka');
    assert.deepEqual(noticeText({ title: 'eski', body: 'matn', text: null }, 'ru'), { title: 'eski', body: 'matn' }, 'an older row');
    assert.deepEqual(noticeText({ title: 'eski', body: 'matn', text: { ru: 'broken' } }, 'ru'), { title: 'eski', body: 'matn' }, 'a malformed text');
  });
});

describe('notifications in the reader\'s language (database)', { skip: await dbSkipReason() }, () => {
  const orgs: string[] = [];
  after(async () => {
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('B13: a Russian reader reads Russian, an Uzbek reader Uzbek, from the same stored notice', async () => {
    const org = await makeOrg();
    orgs.push(org.orgId);
    const text = inEveryLocale((l) => auditReadyText({ clientName: 'Baraka', filename: 'a.xlsx', open: 2 }, l));
    await notify({ orgId: org.orgId, kind: 'catalog.ready', ...text.uz, text, external: false });
    const user = { userId: org.userId, orgId: org.orgId, clientIds: null };
    const [ru] = (await listNotifications(user, { locale: 'ru' })).items;
    const [uz] = (await listNotifications(user, { locale: 'uz' })).items;
    assert.equal(ru?.title, 'Проверка готова: Baraka');
    assert.match(ru?.body ?? '', /^Каталог проверен/);
    assert.equal(uz?.title, 'Tekshiruv tugadi: Baraka');
  });
});
