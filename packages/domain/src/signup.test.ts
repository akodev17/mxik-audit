import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { planStatus } from './plan.js';
import { attemptKey } from './security/rate-limit.js';
import { createAccount } from './signup.js';
import { dbSkipReason, dropOrgs } from './test-fixtures.js';

const skip = await dbSkipReason();
const email = (): string => `test-${randomBytes(5).toString('hex')}@example.uz`;

/** Production without SMTP: no mail can be delivered (the development outbox is off). */
function withoutMail<T>(job: () => Promise<T>): Promise<T> {
  const saved = { url: process.env['SMTP_URL'], from: process.env['MAIL_FROM'], env: process.env['NODE_ENV'] };
  delete process.env['SMTP_URL'];
  delete process.env['MAIL_FROM'];
  process.env['NODE_ENV'] = 'production';
  return job().finally(() => {
    if (saved.url !== undefined) process.env['SMTP_URL'] = saved.url;
    if (saved.from !== undefined) process.env['MAIL_FROM'] = saved.from;
    if (saved.env === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = saved.env;
  });
}

function withMail<T>(job: () => Promise<T>): Promise<T> {
  const saved = { url: process.env['SMTP_URL'], from: process.env['MAIL_FROM'] };
  process.env['SMTP_URL'] = 'smtp://127.0.0.1:9';
  process.env['MAIL_FROM'] = 'Tasnivo <test@example.uz>';
  return job().finally(() => {
    if (saved.url === undefined) delete process.env['SMTP_URL']; else process.env['SMTP_URL'] = saved.url;
    if (saved.from === undefined) delete process.env['MAIL_FROM']; else process.env['MAIL_FROM'] = saved.from;
  });
}

describe('signup (database)', { skip }, () => {
  const orgs: string[] = [];
  const emails: string[] = [];
  const created = async (input: Parameters<typeof createAccount>[0]) => {
    const result = await createAccount(input);
    if (result.ok) orgs.push(result.account.orgId);
    return result;
  };
  after(async () => {
    await db.authAttempt.deleteMany({ where: { key: { in: emails.map(attemptKey) } } });
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('signing up again with an unconfirmed address mails the owner and creates nothing', async () => {
    const to = email();
    emails.push(to);
    const firm = `test-${randomBytes(5).toString('hex')}`;
    const first = await withMail(() => created({ email: to, password: 'password-1', firmName: firm }));
    assert.ok(first.ok && first.account.needsVerification);
    const again = await withMail(() => created({ email: to, password: 'password-2', firmName: firm }));
    assert.deepEqual(again, { ok: false, mailed: true });
    assert.equal(await db.organization.count({ where: { name: firm } }), 1, 'nothing new was created');
    // The mail carries a set-password link, not the stored password: a pre-registered address cannot be taken over.
    const user = await db.user.findUniqueOrThrow({ where: { email: to }, include: { emailTokens: true } });
    assert.ok(user.emailTokens.some((t) => t.purpose === 'reset' && !t.usedAt));
  });

  it('a confirmed address gets the same answer', async () => {
    const to = email();
    emails.push(to);
    const first = await created({ email: to, password: 'password-1', firmName: 'test-firm' });
    assert.ok(first.ok && first.account.needsVerification, 'a password sign-up always confirms its address');
    await db.user.update({ where: { id: first.account.userId }, data: { emailVerifiedAt: new Date() } });
    assert.deepEqual(await withMail(() => created({ email: to, password: 'password-2', firmName: 'test-firm' })), { ok: false, mailed: true });
  });

  it('when no mail can be delivered it says the address is taken (nothing could be mailed)', async () => {
    const to = email();
    await created({ email: to, password: 'password-1', firmName: 'test-firm' });
    assert.deepEqual(await withoutMail(() => created({ email: to, password: 'password-1', firmName: 'test-firm' })), { ok: false, error: 'emailTaken' });
  });

  it('every way in opens a 14-day trial: password (unconfirmed), Telegram and Google (confirmed)', async () => {
    const id = String(9_100_000_000 + Math.floor(Math.random() * 1_000_000));
    const paths = [
      await created({ email: email(), password: 'password-1', firmName: 'test-firm' }),
      await created({ email: `tg-${id}@telegram.invalid`, password: 'password-1', firmName: 'test-firm', verified: true, telegramUserId: id }),
      await created({ email: email(), password: 'password-1', firmName: 'test-firm', verified: true, googleSub: `g-${id}` }),
    ];
    for (const [i, result] of paths.entries()) {
      assert.ok(result.ok);
      const user = await db.user.findUniqueOrThrow({ where: { id: result.account.userId }, include: { org: true } });
      assert.equal(user.emailVerifiedAt === null, i === 0, 'only the password sign-up waits for its code');
      const status = await planStatus(user.orgId);
      assert.equal(status.state, 'trial');
      assert.equal(status.daysLeft, 14);
      assert.ok(user.org.trialEndsAt);
    }
  });

  it('refuses the reserved domains the app uses for itself', async () => {
    assert.deepEqual(await created({ email: 'tg-1@telegram.invalid', password: 'password-1', firmName: 'x' }), { ok: false, error: 'emailBad' });
    assert.deepEqual(await created({ email: 'demo-1@demo.mxik.local', password: 'password-1', firmName: 'x' }), { ok: false, error: 'emailBad' });
  });

  it('an account opened with Telegram is bound to that Telegram id', async () => {
    const id = String(9_000_000_000 + Math.floor(Math.random() * 1_000_000));
    const result = await created({ email: `tg-${id}@telegram.invalid`, password: 'password-1', firmName: 'test-firm', verified: true, telegramUserId: id });
    assert.ok(result.ok);
    const user = await db.user.findUniqueOrThrow({ where: { id: result.account.userId } });
    assert.equal(user.telegramUserId, id);
    assert.ok(user.emailVerifiedAt);
  });
});
