import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { attemptKey } from '../security/rate-limit.js';
import type { SignInSession } from '../security/sign-in.js';
import { loadAccess } from '../session.js';
import { dbSkipReason, dropOrgs } from '../test-fixtures.js';
import { telegramSignIn } from './login-callbacks.js';

const TOKEN = '123456:test-bot-token';
const newId = (): string => String(8_000_000_000 + Math.floor(Math.random() * 1_000_000_000));

/** Signs widget data the way Telegram does, dated now (minus `secondsAgo`). */
function signed(fields: Record<string, string>, secondsAgo = 0): Record<string, string> {
  const data = { ...fields, auth_date: String(Math.floor(Date.now() / 1000) - secondsAgo) };
  const check = Object.keys(data).sort().map((k) => `${k}=${data[k as keyof typeof data]}`).join('\n');
  const hash = createHmac('sha256', createHash('sha256').update(TOKEN).digest()).update(check).digest('hex');
  return { ...data, hash };
}

const session = (): SignInSession => Object.defineProperty({}, 'save', { value: () => Promise.resolve() }) as SignInSession;

describe('Telegram sign-in callback (database)', { skip: await dbSkipReason() }, () => {
  const orgs: string[] = [];
  const ips: string[] = [];
  const saved = { token: process.env['TELEGRAM_BOT_TOKEN'], name: process.env['TELEGRAM_BOT_USERNAME'] };
  before(() => {
    process.env['TELEGRAM_BOT_TOKEN'] = TOKEN;
    process.env['TELEGRAM_BOT_USERNAME'] = 'tasnivo_test_bot';
  });
  after(async () => {
    for (const [k, v] of [['TELEGRAM_BOT_TOKEN', saved.token], ['TELEGRAM_BOT_USERNAME', saved.name]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await db.authAttempt.deleteMany({ where: { key: { in: ips.map(attemptKey) } } });
    await dropOrgs(orgs);
    await db.$disconnect();
  });
  const req = () => {
    const ip = `10.4.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    ips.push(ip);
    return { ip, userAgent: 'test' };
  };

  it('a new Telegram account gets a confirmed 14-day trial org, bound to it, and lands on the dashboard', async () => {
    const id = newId();
    const s = session();
    assert.equal(await telegramSignIn(s, signed({ id, first_name: 'Aziz', username: 'aziz_t' }), req()), '/dashboard');
    const user = await db.user.findUniqueOrThrow({ where: { telegramUserId: id }, include: { org: true } });
    orgs.push(user.orgId);
    assert.ok(user.emailVerifiedAt, 'counts as confirmed');
    assert.equal(user.role, 'admin');
    assert.equal(user.org.name, 'Aziz');
    const days = ((user.org.trialEndsAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
    assert.ok(days > 13.9 && days <= 14, `trial of 14 days (${days})`);
    assert.equal(s.userId, user.id);
    // The API lets this user past AccessGuard.
    assert.equal((await loadAccess(user.id, user.orgId))?.verified, true);
    // Its private chat is linked for notifications.
    assert.ok(await db.telegramLink.findUnique({ where: { chatId: id } }));

    // Signing in again is the same user and org, not a second trial.
    const again = session();
    assert.equal(await telegramSignIn(again, signed({ id, first_name: 'Aziz' }, 1), req()), '/dashboard');
    assert.equal(again.userId, user.id);
    assert.equal(await db.organization.count({ where: { users: { some: { telegramUserId: id } } } }), 1);
  });

  it('refuses replayed, stale, forged or foreign data', async () => {
    const id = newId();
    const data = signed({ id, first_name: 'Bek' });
    assert.equal(await telegramSignIn(session(), data, req()), '/dashboard');
    orgs.push((await db.user.findUniqueOrThrow({ where: { telegramUserId: id } })).orgId);
    assert.equal(await telegramSignIn(session(), data, req()), '/sign-in?error=telegram_expired', 'the same hash twice');
    assert.equal(await telegramSignIn(session(), signed({ id }, 600), req()), '/sign-in?error=telegram_expired', 'older than five minutes');
    assert.equal(await telegramSignIn(session(), { ...signed({ id: newId() }), id }, req()), '/sign-in?error=telegram_expired', 'a changed id');
  });

  it('without a bot configured the callback goes back to sign-in', async () => {
    delete process.env['TELEGRAM_BOT_USERNAME'];
    try {
      assert.equal(await telegramSignIn(session(), signed({ id: newId() }), req()), '/sign-in');
    } finally {
      process.env['TELEGRAM_BOT_USERNAME'] = 'tasnivo_test_bot';
    }
  });
});
