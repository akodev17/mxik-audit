import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CONTACT_ERROR, HONEYPOT_FIELD, clientKey, createRateLimiter, isHoneypotFilled, parseContact,
} from './lead-guard.js';

describe('parseContact', () => {
  it('accepts Uzbek numbers in the shapes people type them', () => {
    for (const raw of ['+998 90 123 45 67', '+998-90-123-45-67', '998901234567', '90 123 45 67', '(90) 123-45-67']) {
      assert.deepEqual(parseContact(raw), { ok: true, kind: 'phone', value: '+998901234567' }, raw);
    }
  });

  it('accepts a full international number from another country', () => {
    assert.deepEqual(parseContact('+7 701 123 45 67'), { ok: true, kind: 'phone', value: '+77011234567' });
  });

  it('rejects numbers that are too short, too long or unprefixed foreign', () => {
    for (const raw of ['12345', '+998 90 123', '90 123 45 67 89 01', '77011234567', '+1234567890123456']) {
      assert.deepEqual(parseContact(raw), { ok: false, error: CONTACT_ERROR }, raw);
    }
  });

  it('accepts Telegram handles, links and bare usernames, normalised to @name', () => {
    for (const raw of ['@buxgalter_uz', 't.me/buxgalter_uz', 'https://t.me/buxgalter_uz', 'buxgalter_uz']) {
      assert.deepEqual(parseContact(raw), { ok: true, kind: 'telegram', value: '@buxgalter_uz' }, raw);
    }
  });

  it('rejects malformed Telegram usernames', () => {
    for (const raw of ['@abc', '@1buxgalter', '@bux galter', '@buxgalter_', 't.me/', '@кириллица']) {
      assert.equal(parseContact(raw).ok, false, raw);
    }
  });

  it('rejects empty, whitespace and oversized input', () => {
    assert.equal(parseContact('').ok, false);
    assert.equal(parseContact('   ').ok, false);
    assert.equal(parseContact(`@${'a'.repeat(200)}`).ok, false);
  });

  it('rejects free text', () => {
    assert.equal(parseContact('Salom, menga qoʻngʻiroq qiling').ok, false);
  });
});

describe('honeypot', () => {
  it('passes a form where the hidden field is empty or absent', () => {
    const form = new FormData();
    form.set('contact', '@buxgalter');
    assert.equal(isHoneypotFilled(form), false);
    form.set(HONEYPOT_FIELD, '   ');
    assert.equal(isHoneypotFilled(form), false);
  });

  it('flags a form where the hidden field was filled', () => {
    const form = new FormData();
    form.set(HONEYPOT_FIELD, 'https://spam.example');
    assert.equal(isHoneypotFilled(form), true);
  });
});

describe('createRateLimiter', () => {
  it('allows `limit` hits per window, then blocks with a retry time', () => {
    let t = 1_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });
    assert.equal(limiter.hit('a').allowed, true);
    assert.equal(limiter.hit('a').allowed, true);
    assert.equal(limiter.hit('a').allowed, true);
    t += 10_000;
    const blocked = limiter.hit('a');
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterMs, 50_000);
  });

  it('keeps keys independent', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
    assert.equal(limiter.hit('a').allowed, true);
    assert.equal(limiter.hit('a').allowed, false);
    assert.equal(limiter.hit('b').allowed, true);
  });

  it('lets a key through again once its window has passed', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => t });
    assert.equal(limiter.hit('a').allowed, true);
    t = 59_999;
    assert.equal(limiter.hit('a').allowed, false);
    t = 60_000;
    assert.equal(limiter.hit('a').allowed, true);
  });

  it('sweeps expired keys so memory stays bounded', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => t, maxKeys: 2 });
    limiter.hit('a');
    limiter.hit('b');
    t = 5_000;
    limiter.hit('c'); // triggers a sweep of a and b
    assert.equal(limiter.hit('a').allowed, true);
  });
});

describe('clientKey', () => {
  const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n] ?? null });

  it('uses the rightmost X-Forwarded-For hop, never the client-supplied leftmost one', () => {
    assert.equal(clientKey(headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.5' })), '203.0.113.5');
  });

  it('prefers X-Real-IP, then falls back to a shared bucket', () => {
    assert.equal(clientKey(headers({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6, 203.0.113.9' })), '203.0.113.9');
    assert.equal(clientKey(headers({})), 'unknown');
  });
});
