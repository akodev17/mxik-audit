import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalEmail, checkDemoEmail, isDisposableEmail, normalizeEmail } from './demo-email.js';
import { demoBlockedDomains, demoIdleMinutes, demoLinkMinutes, demoMaxExports, demoMaxPerEmail, demoTtlHours } from './demo-config.js';

describe('demo e-mail rules', () => {
  it('maps aliases of one mailbox to one key', () => {
    assert.equal(canonicalEmail('  Ali.Valiyev+demo2@Gmail.com '), 'alivaliyev@gmail.com');
    assert.equal(canonicalEmail('ali.valiyev@googlemail.com'), 'alivaliyev@gmail.com');
    assert.equal(canonicalEmail('a.li+x@firma.uz'), 'a.li@firma.uz', 'dots count for other providers, plus tags never do');
    assert.equal(canonicalEmail('+tag@firma.uz'), '+tag@firma.uz', 'an address made only of a tag is left as typed');
    assert.equal(normalizeEmail(' A@B.UZ '), 'a@b.uz');
  });

  it('refuses throwaway providers, also on subdomains and with extra domains from the config', () => {
    assert.equal(isDisposableEmail('x@mailinator.com', []), true);
    assert.equal(isDisposableEmail('x@sub.mailinator.com', []), true);
    assert.equal(isDisposableEmail('X@YOPMAIL.com', []), true);
    assert.equal(isDisposableEmail('x@firma.uz', []), false);
    assert.equal(isDisposableEmail('x@notmailinator.com', []), false, 'only the domain or its parents, not a lookalike suffix');
    assert.equal(isDisposableEmail('x@junk.example', ['junk.example']), true);
  });

  it('judges the whole address', () => {
    assert.equal(checkDemoEmail('ali@firma.uz'), 'ok');
    assert.equal(checkDemoEmail('ali@mailinator.com'), 'disposable');
    assert.equal(checkDemoEmail('not-an-address'), 'invalid');
    assert.equal(checkDemoEmail('tg-1@telegram.invalid'), 'invalid', 'addresses the app makes for itself are not people');
    assert.equal(checkDemoEmail(`${'a'.repeat(200)}@firma.uz`), 'invalid');
  });
});

describe('demo settings', () => {
  it('have the defaults the brief asks for and read overrides, ignoring nonsense', () => {
    assert.equal(demoIdleMinutes({}), 30);
    assert.equal(demoTtlHours({}), 24);
    assert.equal(demoLinkMinutes({}), 30);
    assert.equal(demoMaxPerEmail({}), 3);
    assert.equal(demoMaxExports({}), 10);
    assert.equal(demoIdleMinutes({ DEMO_IDLE_MINUTES: '5' }), 5);
    assert.equal(demoIdleMinutes({ DEMO_IDLE_MINUTES: '-3' }), 30);
    assert.equal(demoIdleMinutes({ DEMO_IDLE_MINUTES: 'abc' }), 30);
    assert.deepEqual(demoBlockedDomains({ DEMO_BLOCKED_DOMAINS: ' A.com, @b.org ,,' }), ['a.com', 'b.org']);
  });
});
