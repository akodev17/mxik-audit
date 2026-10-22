import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from './db.js';
import { acceptInvite, createInvite } from './invites.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();
const email = (): string => `test-${randomBytes(5).toString('hex')}@example.uz`;
const tokenOf = (url: string): string => url.split('/invite/')[1] ?? '';

// A closed local port: mail "is configured" but every send fails fast.
function withMail<T>(job: () => Promise<T>): Promise<T> {
  const saved = { url: process.env['SMTP_URL'], from: process.env['MAIL_FROM'] };
  process.env['SMTP_URL'] = 'smtp://127.0.0.1:9';
  process.env['MAIL_FROM'] = 'Tasnivo <test@example.uz>';
  return job().finally(() => {
    if (saved.url === undefined) delete process.env['SMTP_URL']; else process.env['SMTP_URL'] = saved.url;
    if (saved.from === undefined) delete process.env['MAIL_FROM']; else process.env['MAIL_FROM'] = saved.from;
  });
}

describe('invite verification (database)', { skip }, () => {
  let a: TestActor;
  before(async () => { a = await makeOrg(); });
  after(async () => {
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  it('an invite sent to an address confirms that address, so the member can sign in again once SMTP is on', async () => {
    const to = email();
    const { url } = await createInvite(a, { email: to, role: 'accountant', clientIds: [] });
    const joined = await acceptInvite(tokenOf(url), to, 'password-123');
    assert.ok(joined.ok);
    const user = await db.user.findUniqueOrThrow({ where: { email: to } });
    assert.ok(user.emailVerifiedAt);
  });

  it('a link without an address leaves it unconfirmed and, with mail on, sends a confirmation link', async () => {
    const { url } = await createInvite(a, { email: null, role: 'viewer', clientIds: [] });
    const to = email();
    const joined = await withMail(() => acceptInvite(tokenOf(url), to, 'password-123'));
    assert.ok(joined.ok);
    const user = await db.user.findUniqueOrThrow({ where: { email: to }, include: { emailTokens: true } });
    assert.equal(user.emailVerifiedAt, null);
    assert.equal(user.emailTokens.filter((t) => t.purpose === 'verify' && !t.usedAt).length, 1);
  });

  it('without mail, a link without an address sends nothing', async () => {
    const { url } = await createInvite(a, { email: null, role: 'viewer', clientIds: [] });
    const to = email();
    assert.ok((await acceptInvite(tokenOf(url), to, 'password-123')).ok);
    const user = await db.user.findUniqueOrThrow({ where: { email: to }, include: { emailTokens: true } });
    assert.equal(user.emailTokens.length, 0);
  });

  it('refuses reserved and malformed addresses on a link without one', async () => {
    const { url } = await createInvite(a, { email: null, role: 'viewer', clientIds: [] });
    for (const bad of ['tg-123@telegram.invalid', 'demo-1@demo.mxik.local', 'not-an-email']) {
      assert.deepEqual(await acceptInvite(tokenOf(url), bad, 'password-123'), { ok: false, error: 'emailBad' }, bad);
    }
  });
});
