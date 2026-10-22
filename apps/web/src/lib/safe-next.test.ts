import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { safeNext as original } from '@tasnivo/domain/security/safe-next';
import { safeNext } from './safe-next.js';

describe('the web copy of safeNext', () => {
  it('answers what the domain original answers', () => {
    const samples: unknown[] = [
      undefined, null, 42, '', '/', '/dashboard', '/catalogs/x?tab=1#a', '//evil.test', '/\evil.test', 'https://evil.test',
      '/sign-in', '/sign-in/2fa', '/sign-in-later', '/a\tb', '/a\nb', `/${'x'.repeat(600)}`, '/%2F%2Fevil', '/ok/../sign-in',
    ];
    for (const raw of samples) assert.equal(safeNext(raw), original(raw), String(raw));
  });
});
