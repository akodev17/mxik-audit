// Fixtures the auth, account and team e2e tests share: a signed-in cookie without going through the
// sign-in form (no rate limit spent), extra members, a fake job dispatcher catching mail, the
// environment switches (SMTP, Telegram) the forms read at call time, and signed Telegram data.
// Import ./setup-env before this file.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sealData, unsealData } from 'iron-session';
import request from 'supertest';
import { db } from '@tasnivo/db';
import { setJobs, type JobDispatcher } from '@tasnivo/domain/jobs/dispatcher';
import type { MailJobData } from '@tasnivo/domain/jobs/queues';
import { hashPassword } from '@tasnivo/domain/password';
import { createRecord } from '@tasnivo/domain/security/session-store';
import { sessionOptions, type SessionData } from '@tasnivo/domain/session';
import { SESSION_COOKIE } from '../src/auth-core/session.service';
import { cookiePair, dropOrgs, makeUser, serverOf, setCookies, testIp, type TestUser } from './helpers';

export const CSRF = { 'X-Requested-With': 'tasnivo' } as const;

/** "name=value" of a session cookie for a live session record of the user. */
export async function sessionCookie(u: Pick<TestUser, 'userId' | 'orgId' | 'email'>, extra: Partial<SessionData> = {}): Promise<string> {
  const sid = await createRecord(u.userId, u.orgId, 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36');
  return `${SESSION_COOKIE}=${await sealData({ userId: u.userId, orgId: u.orgId, email: u.email, sid, ...extra } satisfies SessionData, { password: sessionOptions.password })}`;
}

/** The fields sealed in a session cookie pair. */
export async function unsealPair(pair: string): Promise<SessionData> {
  return unsealData<SessionData>(decodeURIComponent(pair.slice(SESSION_COOKIE.length + 1)), { password: sessionOptions.password });
}

/** The session cookie a response set, as "name=value". */
export const sessionPair = (res: { headers: Record<string, unknown> }): string | undefined => cookiePair(setCookies(res), SESSION_COOKIE);

/** Orgs (and so users) created by a test file; dropped in after(). */
export class Fixtures {
  readonly orgs: string[] = [];

  /** A confirmed admin of a fresh org; `plan`: a running trial (default), a paid subscription (no caps) or ended. */
  async user(options: Parameters<typeof makeUser>[0] & { plan?: 'trial' | 'firm' | 'expired' } = {}): Promise<TestUser> {
    const u = await makeUser(options);
    this.orgs.push(u.orgId);
    // A plain customer org without a trial or subscription is "expired".
    const until = new Date(Date.now() + 7 * 86_400_000);
    const plan = options.plan ?? 'trial';
    if (plan !== 'expired') await db.organization.update({ where: { id: u.orgId }, data: plan === 'trial' ? { trialEndsAt: until } : { subscriptionUntil: until } });
    return u;
  }

  /** The user with an address a person could own (test users get the reserved .local domain, which counts as a Telegram-made account). */
  async realEmail(u: TestUser): Promise<TestUser> {
    const email = u.email.replace(/@test.local$/, '@example.com');
    await db.user.update({ where: { id: u.userId }, data: { email } });
    return { ...u, email };
  }

  /** Another member of the user's org. */
  async member(of: Pick<TestUser, 'orgId'>, role: 'admin' | 'accountant' | 'viewer'): Promise<TestUser> {
    const tag = randomBytes(5).toString('hex');
    const password = `pw-${tag}-secret`;
    const row = await db.user.create({ data: { orgId: of.orgId, email: `test-${tag}@test.local`, passwordHash: await hashPassword(password), emailVerifiedAt: new Date(), role } });
    return { orgId: of.orgId, userId: row.id, email: row.email, password };
  }

  /** Remembers the org of an account the API created (sign-up). */
  async adopt(email: string): Promise<void> {
    const row = await db.user.findUnique({ where: { email }, select: { orgId: true } });
    if (row) this.orgs.push(row.orgId);
  }

  drop(): Promise<void> {
    return dropOrgs(this.orgs);
  }
}

/** A test client over the in-memory app: `call(cookie).post(path)` sends the CSRF header and a fresh client address. */
export function client(app: INestApplication) {
  const http = () => request(serverOf(app));
  const prep = <T extends request.Test>(t: T, cookie?: string, ip = testIp()): T => {
    t.set('X-Requested-With', 'tasnivo').set('X-Real-IP', ip).set('User-Agent', 'api-e2e');
    if (cookie) t.set('Cookie', cookie);
    return t;
  };
  return (cookie?: string, ip?: string) => ({
    get: (path: string) => prep(http().get(path), cookie, ip),
    post: (path: string) => prep(http().post(path), cookie, ip),
    put: (path: string) => prep(http().put(path), cookie, ip),
    patch: (path: string) => prep(http().patch(path), cookie, ip),
    delete: (path: string) => prep(http().delete(path), cookie, ip),
  });
}

/** Sets environment variables for the duration of `job`, restoring them afterwards. */
export async function withEnv<T>(vars: Record<string, string | undefined>, job: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const apply = (v: Record<string, string | undefined>) => {
    for (const [k, value] of Object.entries(v)) {
      if (value === undefined) delete process.env[k];
      else process.env[k] = value;
    }
  };
  apply(vars);
  try {
    return await job();
  } finally {
    apply(before);
  }
}

/** SMTP "configured" (mailEnabled) with a server nobody listens on: direct sends fail fast, queued mail is caught. */
export const MAIL_ON = { SMTP_URL: 'smtp://127.0.0.1:1', MAIL_FROM: 'test@test.local' };

/** Catches mail handed to the job dispatcher; restore() puts the environment's dispatcher back. */
export function catchMail(): { mails: MailJobData[]; restore(): void } {
  const mails: MailJobData[] = [];
  const fake = {
    mode: 'inline',
    enqueueMail: (mail: MailJobData) => {
      mails.push(mail);
      return Promise.resolve();
    },
    enqueueAudit: () => Promise.resolve(),
    enqueueDocCheck: () => Promise.resolve(),
    enqueueTelegram: () => Promise.resolve(),
    enqueueClassifierUpdate: () => Promise.resolve(),
  } satisfies JobDispatcher;
  setJobs(fake);
  return { mails, restore: () => setJobs(null) };
}

export const TELEGRAM_TOKEN = '123456:test-bot-token';
export const TELEGRAM_ON = { TELEGRAM_BOT_TOKEN: TELEGRAM_TOKEN, TELEGRAM_BOT_USERNAME: 'tasnivo_test_bot' };

/** Login Widget data for a Telegram id, signed with the bot token as Telegram does. */
export function telegramData(id: string, extra: Record<string, string> = {}): Record<string, string> {
  const data: Record<string, string> = { id, first_name: 'Test', auth_date: String(Math.floor(Date.now() / 1000)), ...extra };
  const check = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join('\n');
  const secret = createHash('sha256').update(TELEGRAM_TOKEN).digest();
  return { ...data, hash: createHmac('sha256', secret).update(check).digest('hex') };
}

export const query = (data: Record<string, string>): string => new URLSearchParams(data).toString();

/**
 * Mail and Telegram off for a whole test file, whatever the developer's .env says; the returned
 * function restores them (call it in after()).
 */
export function quietEnv(): () => void {
  const keys = ['SMTP_URL', 'MAIL_FROM', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  return () => {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  };
}
