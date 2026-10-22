import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { authenticate, createApiKey } from '../api/keys.js';
import { db } from '../db.js';
import { createShareLink, resolveShare } from '../share.js';
import { linkForChat } from '../telegram/linking.js';
import { dbSkipReason, dropOrgs, makeCatalog, makeOrg, type TestActor } from '../test-fixtures.js';
import { orgActive } from './org-active.js';

const skip = await dbSkipReason();
const DAY = 86_400_000;

describe('closed accounts stop everything that runs without a sign-in (database)', { skip }, () => {
  let a: TestActor;
  let token = '';
  let shareToken = '';
  let shareId = '';
  const chatId = String(7_000_000_000 + randomBytes(3).readUIntBE(0, 3));

  before(async () => {
    a = await makeOrg();
    token = (await createApiKey({ ...a, role: 'admin' }, 'test'))?.token ?? '';
    const { catalogId } = await makeCatalog(a.orgId, [{ rawName: 'Guruch', suggestedMxik: null, confidence: null }]);
    const share = await createShareLink(a, catalogId, { days: 7, includePdf: false });
    shareToken = share?.url.split('/r/')[1] ?? '';
    shareId = (await resolveShare(shareToken))?.id ?? '';
    await db.telegramLink.create({ data: { orgId: a.orgId, chatId, linkedBy: a.userId } });
  });
  after(async () => {
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  it('works while the account is open', async () => {
    assert.equal(await orgActive(a.orgId), true);
    assert.ok(await authenticate(`Bearer ${token}`));
    assert.ok(shareId);
    assert.ok(await linkForChat(chatId));
  });

  it('a share link stops at its expiry', async () => {
    assert.equal(await resolveShare(shareToken, new Date(Date.now() + 8 * DAY)), null);
  });

  it('after closing: the API key, the share link and the bot chat are refused', async () => {
    await db.organization.update({ where: { id: a.orgId }, data: { deletedAt: new Date() } });
    assert.equal(await orgActive(a.orgId), false);
    assert.equal(await authenticate(`Bearer ${token}`), null);
    assert.equal(await resolveShare(shareToken), null);
    assert.equal(await linkForChat(chatId), null);
  });

  it('restoring the account brings them back', async () => {
    await db.organization.update({ where: { id: a.orgId }, data: { deletedAt: null } });
    assert.ok(await authenticate(`Bearer ${token}`));
    assert.ok(await resolveShare(shareToken));
  });

  it('an unknown org is not active', async () => {
    assert.equal(await orgActive('no-such-org'), false);
  });
});
