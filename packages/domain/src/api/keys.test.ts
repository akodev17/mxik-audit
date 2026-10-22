// API keys are admin-only, and a key works only while its creator is an admin of the org.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from '../db.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from '../test-fixtures.js';
import { authenticate, createApiKey, revokeApiKey } from './keys.js';

const skip = await dbSkipReason();
const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** A key row made directly, so the token is known without going through createApiKey. */
async function rawKey(orgId: string, createdBy: string | null): Promise<string> {
  const token = `mxk_${randomBytes(24).toString('base64url')}`;
  await db.apiKey.create({ data: { orgId, name: 'raw', prefix: token.slice(0, 10), tokenHash: hash(token), createdBy } });
  return token;
}

describe('API keys (database)', { skip }, () => {
  let a: TestActor;
  before(async () => {
    a = await makeOrg();
  });
  after(async () => {
    await dropOrgs([a.orgId]);
  });

  it('only an admin creates or revokes a key', async () => {
    for (const role of ['accountant', 'viewer'] as const) {
      // Compared as a boolean so a created token never reaches the test output.
      assert.equal((await createApiKey({ ...a, role }, `k-${role}`)) === null, true);
    }
    assert.equal(await db.apiKey.count({ where: { orgId: a.orgId } }), 0);
    assert.equal((await createApiKey({ ...a, role: 'admin' }, 'admin key')) !== null, true);
    const key = await db.apiKey.findFirstOrThrow({ where: { orgId: a.orgId, name: 'admin key' }, select: { id: true } });
    assert.equal(await revokeApiKey({ ...a, role: 'viewer' }, key.id), false);
    assert.equal((await db.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt, null);
    assert.equal(await revokeApiKey({ ...a, role: 'admin' }, key.id), true);
  });

  it('a key stops authenticating once its creator is no longer an admin', async () => {
    const creator = await db.user.create({ data: { orgId: a.orgId, email: `test-${randomBytes(4).toString('hex')}@test.local`, passwordHash: 'x', role: 'admin' } });
    const token = await rawKey(a.orgId, creator.id);
    assert.equal((await authenticate(`Bearer ${token}`))?.orgId, a.orgId);
    await db.user.update({ where: { id: creator.id }, data: { role: 'viewer' } });
    assert.equal(await authenticate(`Bearer ${token}`), null);
  });

  it('a key whose creator was never recorded still works', async () => {
    const token = await rawKey(a.orgId, null);
    assert.equal((await authenticate(`Bearer ${token}`))?.orgId, a.orgId);
  });
});
