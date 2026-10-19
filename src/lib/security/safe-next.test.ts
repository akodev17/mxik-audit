import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { safeNext } from './safe-next.js';

describe('safeNext', () => {
  it('keeps same-site paths with their query and hash', () => {
    assert.equal(safeNext('/dashboard'), '/dashboard');
    assert.equal(safeNext('/catalogs/abc?view=risky#row-3'), '/catalogs/abc?view=risky#row-3');
  });

  it('refuses other origins, however they are written', () => {
    for (const raw of ['//evil.example', '///evil.example', '/\\evil.example', '\\\\evil.example', 'https://evil.example', 'javascript:alert(1)', 'evil.example/x', 'dashboard']) {
      assert.equal(safeNext(raw), null, raw);
    }
  });

  it('refuses raw control characters browsers would strip', () => {
    for (const raw of ['/\t/evil.example', '/\n/evil.example', '/x\u0000', '/\u007f']) assert.equal(safeNext(raw), null, JSON.stringify(raw));
    // Percent-encoded, it stays a harmless path on this site.
    assert.equal(safeNext('/%0a'), '/%0a');
  });

  it('refuses the sign-in pages, so a signed-in visitor cannot loop', () => {
    assert.equal(safeNext('/sign-in'), null);
    assert.equal(safeNext('/sign-in/2fa'), null);
    assert.equal(safeNext('/sign-in?next=/x'), null);
  });

  it('refuses empty, oversized and non-string input', () => {
    assert.equal(safeNext(''), null);
    assert.equal(safeNext(undefined), null);
    assert.equal(safeNext(['/dashboard']), null);
    assert.equal(safeNext(`/${'a'.repeat(600)}`), null);
  });
});
