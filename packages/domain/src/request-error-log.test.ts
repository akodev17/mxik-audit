import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requestErrorLine } from './request-error-log.js';

describe('requestErrorLine', () => {
  it('names the route and the digest the error page shows, without the query string', () => {
    const error = Object.assign(new Error("Value 'RESTRICTED' not found in enum 'FindingType'"), { digest: '4172' });
    const line = requestErrorLine(error, { method: 'GET', path: '/catalogs/abc?q=un' }, { routePath: '/(app)/catalogs/[id]', routeType: 'render' });
    assert.equal(line, "[request-error] GET /catalogs/abc route=/(app)/catalogs/[id] render digest=4172: Value 'RESTRICTED' not found in enum 'FindingType'");
  });

  it('copes with a thrown non-error and a missing context', () => {
    assert.equal(requestErrorLine('boom', { method: 'POST', path: '/api/x' }, {}), '[request-error] POST /api/x: boom');
  });
});
