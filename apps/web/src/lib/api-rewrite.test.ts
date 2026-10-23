// Q18: the /api rewrite's destination is baked in at build time; the config names it in the build
// output so a build made against the wrong API (localhost:4000 by default) is visible.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { apiRewrites } from './api-rewrite';

describe('apiRewrites (Q18)', () => {
  it('rewrites to API_INTERNAL_URL and says so', () => {
    const lines: string[] = [];
    assert.deepEqual(apiRewrites({ API_INTERNAL_URL: 'http://localhost:4026/' }, (l) => lines.push(l)), [{ source: '/api/:path*', destination: 'http://localhost:4026/api/:path*' }]);
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? '', /localhost:4026\/api\/\* \(API_INTERNAL_URL\)/);
  });

  it('names the default when API_INTERNAL_URL is not set at build time', () => {
    const lines: string[] = [];
    assert.deepEqual(apiRewrites({}, (l) => lines.push(l)), [{ source: '/api/:path*', destination: 'http://localhost:4000/api/:path*' }]);
    assert.match(lines[0] ?? '', /localhost:4000.*default, API_INTERNAL_URL not set/);
  });

  it('rewrites nothing when the browser calls the API itself', () => {
    const lines: string[] = [];
    assert.deepEqual(apiRewrites({ NEXT_PUBLIC_API_URL: 'https://api.example.uz' }, (l) => lines.push(l)), []);
    assert.match(lines[0] ?? '', /NEXT_PUBLIC_API_URL/);
  });
});
