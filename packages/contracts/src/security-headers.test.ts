// The web app's security headers (this package's copy, wired in apps/web/next.config.ts) must equal the
// API's (the domain's security/headers.ts).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contentSecurityPolicy as domainCsp, securityHeaders as domainHeaders } from '@tasnivo/domain/security/headers';
import { contentSecurityPolicy, securityHeaders } from './security-headers';

describe('security headers copy', () => {
  it('equals the domain original in development and production', () => {
    for (const dev of [true, false]) assert.equal(contentSecurityPolicy(dev), domainCsp(dev));
    for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'development' }, {}]) assert.deepEqual(securityHeaders(env), domainHeaders(env));
  });
});
