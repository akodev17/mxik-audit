import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contentSecurityPolicy, securityHeaders } from './headers.js';

const directive = (csp: string, name: string): string[] =>
  csp.split(';').map((d) => d.trim().split(/\s+/)).find(([n]) => n === name)?.slice(1) ?? [];

describe('security headers', () => {
  it('locks the page to its own origin plus the Telegram login widget', () => {
    const csp = contentSecurityPolicy(false);
    assert.deepEqual(directive(csp, 'default-src'), ["'self'"]);
    assert.deepEqual(directive(csp, 'frame-ancestors'), ["'none'"]);
    assert.ok(directive(csp, 'script-src').includes('https://telegram.org'));
    assert.deepEqual(directive(csp, 'frame-src'), ['https://oauth.telegram.org']);
    assert.deepEqual(directive(csp, 'connect-src'), ["'self'"]);
    for (const src of ["'self'", 'data:', 'blob:', 'https://t.me', 'https://telegram.org']) assert.ok(directive(csp, 'img-src').includes(src), src);
  });

  it("allows eval and the hot-reload websocket only in development", () => {
    assert.ok(!directive(contentSecurityPolicy(false), 'script-src').includes("'unsafe-eval'"));
    assert.ok(directive(contentSecurityPolicy(true), 'script-src').includes("'unsafe-eval'"));
    assert.ok(directive(contentSecurityPolicy(true), 'connect-src').includes('ws:'));
  });

  it('sends HSTS only in production', () => {
    const keys = (env: Record<string, string>) => securityHeaders(env).map((h) => h.key);
    assert.ok(keys({ NODE_ENV: 'production' }).includes('Strict-Transport-Security'));
    assert.ok(!keys({ NODE_ENV: 'development' }).includes('Strict-Transport-Security'));
    for (const key of ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
      assert.ok(keys({}).includes(key), key);
    }
  });

  it('uses the agreed values', () => {
    const value = (key: string) => securityHeaders({ NODE_ENV: 'production' }).find((h) => h.key === key)?.value;
    assert.equal(value('X-Content-Type-Options'), 'nosniff');
    assert.equal(value('Referrer-Policy'), 'strict-origin-when-cross-origin');
    assert.equal(value('Permissions-Policy'), 'camera=(), microphone=(), geolocation=()');
  });
});
