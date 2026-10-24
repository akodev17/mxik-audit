// ModuleGuard with fake requests and given states: no database, no HTTP server.
import '../setup-env';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allEnabled, FEATURE_STATES, type FeatureState, type ModuleStates } from '@tasnivo/contracts/feature-modules';
import { ModuleGuard } from '../../src/features/module.guard';
import { ApiError } from '../../src/http/errors';
import { fakeReq, httpContext } from '../helpers';

/** The guard's answer for a GET of `path` under `states`: 'pass' or the refusal's status and code. */
async function answer(path: string, states: ModuleStates, reads = { n: 0 }): Promise<string> {
  const guard = new ModuleGuard(() => { reads.n += 1; return Promise.resolve(states); });
  try {
    assert.equal(await guard.canActivate(httpContext(fakeReq({ path }))), true);
    return 'pass';
  } catch (error) {
    assert.ok(error instanceof ApiError);
    return `${error.status} ${error.code}`;
  }
}

const didox = (state: FeatureState): ModuleStates => ({ ...allEnabled(), didox: state });

describe('ModuleGuard', () => {
  it('passes an ENABLED module and answers 404 for COMING_SOON and HIDDEN, on every route under the prefix', async () => {
    const expected: Record<FeatureState, string> = { ENABLED: 'pass', COMING_SOON: '404 not_found', HIDDEN: '404 not_found' };
    for (const state of FEATURE_STATES) {
      for (const path of ['/api/didox/invoices', '/api/didox/invoices/i1/approve', '/api/didox/connection']) {
        assert.equal(await answer(path, didox(state)), expected[state], `${state} ${path}`);
      }
    }
  });

  it('leaves the other modules and the rest of the API alone', async () => {
    const hidden = didox('HIDDEN');
    assert.equal(await answer('/api/bank/statements', hidden), 'pass');
    assert.equal(await answer('/api/didoxes', hidden), 'pass');
    const reads = { n: 0 };
    for (const path of ['/api/shell', '/api/modules', '/api/admin/features', '/api/auth/me']) assert.equal(await answer(path, hidden, reads), 'pass', path);
    assert.equal(reads.n, 0, 'a path outside every module never reads the states');
  });

  it('refuses a catalogue\'s products route when either the audit or the products module is off', async () => {
    const path = '/api/catalogs/c1/products';
    assert.equal(await answer(path, allEnabled()), 'pass');
    assert.equal(await answer(path, { ...allEnabled(), products: 'HIDDEN' }), '404 not_found');
    assert.equal(await answer(path, { ...allEnabled(), mxik_audit: 'COMING_SOON' }), '404 not_found');
    assert.equal(await answer('/api/catalogs/c1/rows', { ...allEnabled(), products: 'HIDDEN' }), 'pass');
  });
});
