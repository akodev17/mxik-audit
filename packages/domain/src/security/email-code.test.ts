import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { hashPassword } from '../password.js';
import { signUpForm } from '../signup.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from '../test-fixtures.js';
import { resendCodeForm, signInForm, verifyCodeForm } from './auth-forms.js';
import { checkCode, CODE_MINUTES, CODE_TRIES, issueCode, normalizeCode } from './email-code.js';
import { attemptKey, RULES } from './rate-limit.js';
import type { SignInSession } from './sign-in.js';
import { confirmCode, VERIFY_PATH } from './verification.js';

const skip = await dbSkipReason();
const tag = (): string => randomBytes(5).toString('hex');
const session = (): SignInSession => Object.defineProperty({}, 'save', { value: () => Promise.resolve() }) as SignInSession;

/** Runs `job` with these environment variables (undefined = unset), then restores them. */
async function withEnv<T>(vars: Record<string, string | undefined>, job: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const put = (values: Record<string, string | undefined>): void => {
    for (const [k, v] of Object.entries(values)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  };
  put(vars);
  try {
    return await job();
  } finally {
    put(saved);
  }
}

describe('normalizeCode', () => {
  it('keeps exactly six digits, ignoring spaces and dashes a person may type', () => {
    assert.equal(normalizeCode('123456'), '123456');
    assert.equal(normalizeCode(' 123 456 '), '123456');
    assert.equal(normalizeCode('123-456'), '123456');
    assert.equal(normalizeCode('12345'), null);
    assert.equal(normalizeCode('1234567'), null);
    assert.equal(normalizeCode('12345a'), null);
  });
});

describe('e-mail confirmation code (database)', { skip }, () => {
  let a: TestActor;
  const orgs: string[] = [];
  const keys: string[] = [];
  let outbox = '';
  before(async () => {
    a = await makeOrg();
    orgs.push(a.orgId);
    outbox = await mkdtemp(join(tmpdir(), 'tasnivo-outbox-'));
  });
  after(async () => {
    await db.authAttempt.deleteMany({ where: { key: { in: keys.map(attemptKey) } } });
    await dropOrgs(orgs);
    await rm(outbox, { recursive: true, force: true });
    await db.$disconnect();
  });

  const req = () => {
    const ip = `10.6.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    keys.push(ip);
    return { ip, userAgent: 'test', locale: 'uz' as const };
  };

  /** A fresh unconfirmed user in the test org. */
  async function user(password = 'password-123'): Promise<{ userId: string; email: string }> {
    const email = `test-${tag()}@example.uz`;
    const row = await db.user.create({ data: { orgId: a.orgId, email, passwordHash: await hashPassword(password) } });
    keys.push(row.id, email);
    return { userId: row.id, email };
  }

  it('issues six digits that confirm once', async () => {
    const u = await user();
    const code = await issueCode(u.userId);
    assert.match(code, /^\d{6}$/);
    const row = await db.emailCode.findFirstOrThrow({ where: { userId: u.userId } });
    assert.notEqual(row.codeHash, code, 'only a hash is stored');
    assert.ok(Math.abs(row.expiresAt.getTime() - Date.now() - CODE_MINUTES * 60_000) < 5_000);
    assert.equal(await checkCode(u.userId, code), 'ok');
    assert.equal(await checkCode(u.userId, code), 'expired', 'used up');
  });

  it('a wrong entry counts, the right code still works', async () => {
    const u = await user();
    const code = await issueCode(u.userId);
    const wrong = code === '000000' ? '111111' : '000000';
    assert.equal(await checkCode(u.userId, wrong), 'wrong');
    assert.equal(await checkCode(u.userId, 'garbage'), 'wrong');
    assert.equal(await checkCode(u.userId, code), 'ok');
  });

  it('an expired code is refused', async () => {
    const u = await user();
    const code = await issueCode(u.userId, new Date(Date.now() - (CODE_MINUTES + 1) * 60_000));
    assert.equal(await checkCode(u.userId, code), 'expired');
  });

  it(`locks the code after ${CODE_TRIES} wrong entries, even for the right one`, async () => {
    const u = await user();
    const code = await issueCode(u.userId);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 1; i < CODE_TRIES; i++) assert.equal(await checkCode(u.userId, wrong), 'wrong');
    assert.equal(await checkCode(u.userId, wrong), 'locked');
    assert.equal(await checkCode(u.userId, code), 'locked');
  });

  it('parallel guesses cannot get more than the allowed tries', async () => {
    const u = await user();
    const code = await issueCode(u.userId);
    const wrong = code === '000000' ? '111111' : '000000';
    await Promise.all(Array.from({ length: CODE_TRIES * 3 }, () => checkCode(u.userId, wrong)));
    const row = await db.emailCode.findFirstOrThrow({ where: { userId: u.userId } });
    assert.equal(row.attempts, CODE_TRIES);
  });

  it('a new code retires the earlier one', async () => {
    const u = await user();
    const first = await issueCode(u.userId);
    const second = await issueCode(u.userId);
    if (first !== second) assert.equal(await checkCode(u.userId, first), 'wrong');
    assert.equal(await checkCode(u.userId, second), 'ok');
  });

  it('confirmCode marks the address confirmed only with the right code', async () => {
    const u = await user();
    const code = await issueCode(u.userId);
    await confirmCode(u.userId, code === '000000' ? '111111' : '000000');
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.userId } })).emailVerifiedAt, null);
    assert.equal(await confirmCode(u.userId, code), 'ok');
    assert.ok((await db.user.findUniqueOrThrow({ where: { id: u.userId } })).emailVerifiedAt);
  });

  it('the code form answers in words, sends a confirmed user on, and is rate-limited per user', async () => {
    const u = await user();
    const code = await issueCode(u.userId);
    const wrong = code === '000000' ? '111111' : '000000';
    const first = await verifyCodeForm(u, wrong, { locale: 'uz' });
    assert.ok('error' in first && first.error);
    // Locked after the code's tries, then the per-user limit refuses outright.
    for (let i = 1; i < RULES.verifyCodeUser.limit; i++) await verifyCodeForm(u, wrong, { locale: 'uz' });
    const limited = await verifyCodeForm(u, code, { locale: 'ru' });
    assert.ok('error' in limited && /мин/.test(limited.error ?? ''), 'too many tries');

    const v = await user();
    const right = await issueCode(v.userId);
    assert.deepEqual(await verifyCodeForm(v, right, { locale: 'uz' }), { redirect: '/dashboard' });
    assert.deepEqual(await verifyCodeForm(v, right, { locale: 'uz' }), { redirect: '/dashboard' }, 'already confirmed');
  });

  it(`resending is limited to ${RULES.resendEmail.limit} an hour per mailbox, and each resend replaces the code`, async () => {
    await withEnv({ MAIL_OUTBOX_DIR: outbox, SMTP_URL: undefined, MAIL_FROM: undefined, NODE_ENV: 'test' }, async () => {
      const u = await user();
      const ip = `10.9.${Math.floor(Math.random() * 250)}.1`;
      keys.push(ip);
      for (let i = 0; i < RULES.resendEmail.limit; i++) assert.ok('info' in (await resendCodeForm(u, { ip, locale: 'uz' })));
      const refused = await resendCodeForm(u, { ip, locale: 'uz' });
      assert.ok('error' in refused && refused.error);
      assert.equal(await db.emailCode.count({ where: { userId: u.userId, usedAt: null } }), 1, 'only the newest code is live');
    });
  });

  it('sign-up creates an unconfirmed trial account, mails the code and goes to the code step', async () => {
    await withEnv({ MAIL_OUTBOX_DIR: outbox, SMTP_URL: undefined, MAIL_FROM: undefined, NODE_ENV: 'development' }, async () => {
      const email = `test-${tag()}@example.uz`;
      const ip = `10.8.${Math.floor(Math.random() * 250)}.1`;
      keys.push(email, ip);
      const s = session();
      const answer = await signUpForm(s, { email, password: 'password-123', firm: `test-${tag()}` }, { ip, userAgent: 'test', locale: 'uz' });
      assert.deepEqual(answer, { redirect: VERIFY_PATH });
      const created = await db.user.findUniqueOrThrow({ where: { email }, include: { org: true } });
      orgs.push(created.orgId);
      assert.equal(created.emailVerifiedAt, null);
      assert.equal(s.userId, created.id, 'signed in, to the code step only');
      const days = ((created.org.trialEndsAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
      assert.ok(days > 13.9 && days <= 14, `trial of 14 days (${days})`);

      // The development outbox has the message, and its code confirms the address.
      const files = await readdir(outbox);
      const texts = await Promise.all(files.map((f) => readFile(join(outbox, f), 'utf8')));
      const mail = texts.find((t) => t.startsWith(`To: ${email}\n`));
      assert.ok(mail, 'written to the outbox');
      const code = /\n(\d{6})\n/.exec(mail)?.[1];
      assert.ok(code);
      assert.deepEqual(await verifyCodeForm({ userId: created.id, email }, code, { locale: 'uz' }), { redirect: '/dashboard' });
      assert.ok((await db.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt);
    });
  });

  it('in production without SMTP, sign-up is refused and creates nothing', async () => {
    await withEnv({ SMTP_URL: undefined, MAIL_FROM: undefined, NODE_ENV: 'production' }, async () => {
      const email = `test-${tag()}@example.uz`;
      const ip = `10.7.${Math.floor(Math.random() * 250)}.1`;
      keys.push(ip);
      const answer = await signUpForm(session(), { email, password: 'password-123', firm: 'x' }, { ip, userAgent: null, locale: 'uz' });
      assert.ok('error' in answer && answer.error);
      assert.equal(await db.user.count({ where: { email } }), 0);
    });
  });

  it('signing in with an unconfirmed address opens the code step, not the dashboard', async () => {
    const u = await user('password-456');
    const s = session();
    const answer = await signInForm(s, { email: u.email, password: 'password-456', next: '/catalogs' }, req());
    assert.deepEqual(answer, { redirect: VERIFY_PATH });
    assert.equal(s.userId, u.userId);
    await db.user.update({ where: { id: u.userId }, data: { emailVerifiedAt: new Date() } });
    assert.deepEqual(await signInForm(session(), { email: u.email, password: 'password-456', next: '/catalogs' }, req()), { redirect: '/catalogs' });
  });
});
