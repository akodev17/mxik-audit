import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { dbSkipReason } from '../test-fixtures.js';
import { clientIp, trustProxy } from './client-ip.js';
import { attemptKey, clearAttempts, hit, minutesOf, pruneAttempts, RULES, type Rule } from './rate-limit.js';
import { claimOnce } from './replay.js';

const skip = await dbSkipReason();
const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n] ?? null });
const tag = (): string => `test-${randomBytes(6).toString('hex')}`;

describe('clientIp', () => {
  // Behind the documented proxy (TRUST_PROXY set).
  const behind = (h: Record<string, string>) => clientIp(headers(h), true);

  it('takes the rightmost X-Forwarded-For hop, which the proxy appended, never the leftmost', () => {
    assert.equal(behind({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }), '198.51.100.7');
    assert.equal(behind({ 'x-forwarded-for': ' 198.51.100.7 ' }), '198.51.100.7');
  });

  it('prefers X-Real-IP, set by the proxy from the connection', () => {
    assert.equal(behind({ 'x-real-ip': '198.51.100.9', 'x-forwarded-for': '1.2.3.4' }), '198.51.100.9');
  });

  it('a spoofed leftmost hop does not move the client into a fresh bucket', () => {
    assert.equal(behind({ 'x-forwarded-for': '10.0.0.1, 198.51.100.7' }), behind({ 'x-forwarded-for': '10.0.0.2, 198.51.100.7' }));
  });

  it('falls back to one shared bucket and caps the length', () => {
    assert.equal(behind({}), 'unknown');
    assert.equal(behind({ 'x-real-ip': 'x'.repeat(500) }).length, 64);
  });

  it('Q5: without TRUST_PROXY no header is believed, so the caller uses the socket address', () => {
    assert.equal(clientIp(headers({ 'x-real-ip': '10.77.1.1' }), false), 'unknown');
    assert.equal(clientIp(headers({ 'x-forwarded-for': '10.77.1.2' }), false), 'unknown');
    assert.equal(trustProxy({ NODE_ENV: 'production' }), false, 'unset in production: no proxy is trusted');
    assert.equal(trustProxy({}), true, 'unset in development: dev servers and e2e name their client');
    assert.equal(trustProxy({ TRUST_PROXY: '0' }), false);
    assert.equal(trustProxy({ TRUST_PROXY: '0', NODE_ENV: 'development' }), false);
    assert.equal(trustProxy({ TRUST_PROXY: '1', NODE_ENV: 'production' }), true);
    for (const on of ['1', 'true', 'caddy', 'nginx', ' YES ']) assert.equal(trustProxy({ TRUST_PROXY: on }), true, on);
  });
});

describe('minutesOf', () => {
  it('rounds up to whole minutes, at least one', () => {
    assert.equal(minutesOf(0), 1);
    assert.equal(minutesOf(61_000), 2);
  });
});

describe('database rate limits', { skip }, () => {
  const used: { kind: string; key: string }[] = [];
  const track = (rule: Rule, raw: string): string => {
    used.push({ kind: rule.kind, key: attemptKey(raw) });
    return raw;
  };
  after(async () => {
    for (const u of used) await db.authAttempt.deleteMany({ where: u });
    await db.$disconnect();
  });

  it('allows five password attempts per e-mail, then a cooldown with a retry time', async () => {
    const email = track(RULES.passwordEmail, `${tag()}@example.uz`);
    for (let i = 0; i < 5; i++) assert.equal((await hit(RULES.passwordEmail, email)).allowed, true, `attempt ${i + 1}`);
    const blocked = await hit(RULES.passwordEmail, email);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterMs > 14 * 60_000 && blocked.retryAfterMs <= 15 * 60_000);
    // Another address is not affected.
    assert.equal((await hit(RULES.passwordEmail, track(RULES.passwordEmail, `${tag()}@example.uz`))).allowed, true);
  });

  it('a refused attempt leaves no row, and clearing after the right password resets the count', async () => {
    const email = track(RULES.passwordEmail, `${tag()}@example.uz`);
    for (let i = 0; i < 7; i++) await hit(RULES.passwordEmail, email);
    assert.equal(await db.authAttempt.count({ where: { kind: 'password', key: attemptKey(email) } }), 5);
    await clearAttempts(RULES.passwordEmail, email);
    assert.equal((await hit(RULES.passwordEmail, email)).allowed, true);
  });

  it('limits sign-in attempts per address, counted on the rightmost hop', async () => {
    const ip = track(RULES.signInIp, `198.51.${randomBytes(1)[0]}.${randomBytes(1)[0]}-${tag()}`);
    const seen = clientIp(headers({ 'x-forwarded-for': `6.6.6.6, ${ip}` }), true);
    for (let i = 0; i < RULES.signInIp.limit; i++) await hit(RULES.signInIp, seen);
    const spoofed = clientIp(headers({ 'x-forwarded-for': `7.7.7.7, ${ip}` }), true);
    assert.equal((await hit(RULES.signInIp, spoofed)).allowed, false);
  });

  it('never lets parallel attempts past the limit', async () => {
    const key = track(RULES.passwordEmail, `${tag()}@example.uz`);
    const verdicts = await Promise.all(Array.from({ length: 12 }, () => hit(RULES.passwordEmail, key)));
    assert.ok(verdicts.filter((v) => v.allowed).length <= RULES.passwordEmail.limit);
  });

  it('attempts outside the window do not count', async () => {
    const key = track(RULES.passwordEmail, `${tag()}@example.uz`);
    const old = new Date(Date.now() - 20 * 60_000);
    for (let i = 0; i < 5; i++) await hit(RULES.passwordEmail, key, old);
    assert.equal((await hit(RULES.passwordEmail, key)).allowed, true);
  });

  it('stores keyed hashes, never the e-mail or address itself', async () => {
    const email = track(RULES.resetEmail, `${tag()}@example.uz`);
    await hit(RULES.resetEmail, email);
    assert.equal(await db.authAttempt.count({ where: { key: email } }), 0);
    assert.equal(await db.authAttempt.count({ where: { key: attemptKey(email) } }), 1);
  });

  it('prunes attempts older than a day', async () => {
    const key = track(RULES.signupIp, tag());
    await hit(RULES.signupIp, key, new Date(Date.now() - 26 * 3_600_000));
    await hit(RULES.signupIp, key);
    await pruneAttempts();
    assert.equal(await db.authAttempt.count({ where: { kind: 'signup', key: attemptKey(key) } }), 1);
  });

  it('claimOnce accepts a value once and refuses the replay, also when racing', async () => {
    const value = tag();
    used.push({ kind: 'tg_replay', key: attemptKey(value) });
    assert.equal(await claimOnce('tg_replay', value), true);
    assert.equal(await claimOnce('tg_replay', value), false);
    const racing = tag();
    used.push({ kind: 'tg_replay', key: attemptKey(racing) });
    const results = await Promise.all([claimOnce('tg_replay', racing), claimOnce('tg_replay', racing), claimOnce('tg_replay', racing)]);
    assert.equal(results.filter(Boolean).length, 1);
  });
});
