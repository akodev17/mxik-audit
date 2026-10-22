import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from '../test-fixtures.js';
import { attemptKey } from './rate-limit.js';
import { newSecret, sealSecret } from './totp.js';
import { checkPendingCode, pendingKey } from './two-factor-attempts.js';
import { newRecoveryCode, recoveryHash, verifyLogin } from './two-factor.js';

const skip = await dbSkipReason();

describe('recovery codes', () => {
  it('carry at least 80 bits: 20 hex characters in four groups', () => {
    const code = newRecoveryCode();
    assert.match(code, /^[0-9a-f]{5}-[0-9a-f]{5}-[0-9a-f]{5}-[0-9a-f]{5}$/);
    assert.ok(code.replace(/-/g, '').length * 4 >= 80);
    assert.notEqual(newRecoveryCode(), code);
  });

  it('are stored as a keyed HMAC, not a plain SHA-256, and ignore case and dashes', () => {
    const code = newRecoveryCode();
    const plain = createHash('sha256').update(code.replace(/-/g, '')).digest('hex');
    assert.notEqual(recoveryHash(code), plain);
    assert.equal(recoveryHash(code.toUpperCase().replace(/-/g, ' ')), recoveryHash(code));
  });
});

describe('two-factor attempts (database)', { skip }, () => {
  let a: TestActor;
  const keys: string[] = [];

  before(async () => {
    a = await makeOrg();
    await db.user.update({ where: { id: a.userId }, data: { totpSecret: sealSecret(newSecret()), totpEnabledAt: new Date() } });
  });
  after(async () => {
    await db.authAttempt.deleteMany({ where: { key: { in: keys } } });
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  const pending = (): number => {
    const at = Date.now() + Math.floor(Math.random() * 1_000_000);
    keys.push(attemptKey(pendingKey(a.userId, at)));
    return at;
  };
  const addRecovery = async (): Promise<string> => {
    const code = newRecoveryCode();
    await db.recoveryCode.create({ data: { userId: a.userId, codeHash: recoveryHash(code) } });
    return code;
  };

  it('ends a pending sign-in after five wrong codes, even if the sixth is right', async () => {
    keys.push(attemptKey(a.userId));
    const at = pending();
    for (let i = 0; i < 4; i++) assert.equal(await checkPendingCode(a.userId, at, '000000'), 'wrong', `try ${i + 1}`);
    assert.equal(await checkPendingCode(a.userId, at, '000000'), 'locked');
    assert.equal(await checkPendingCode(a.userId, at, await addRecovery()), 'locked');
  });

  it('a fresh pending sign-in accepts a recovery code once', async () => {
    await db.authAttempt.deleteMany({ where: { kind: 'two_factor_user', key: attemptKey(a.userId) } });
    const code = await addRecovery();
    assert.equal(await checkPendingCode(a.userId, pending(), code), 'ok');
    assert.equal(await checkPendingCode(a.userId, pending(), code), 'wrong');
  });

  it('caps wrong codes per user across pending sign-ins', async () => {
    await db.authAttempt.deleteMany({ where: { kind: 'two_factor_user', key: attemptKey(a.userId) } });
    let last = '';
    for (let i = 0; i < 10; i++) last = await checkPendingCode(a.userId, pending(), '123456');
    assert.equal(last, 'locked');
    assert.equal(await checkPendingCode(a.userId, pending(), await addRecovery()), 'locked');
    await db.authAttempt.deleteMany({ where: { kind: 'two_factor_user', key: attemptKey(a.userId) } });
  });

  it('still accepts a recovery code issued before the HMAC (legacy 10 hex characters)', async () => {
    const legacy = randomBytes(5).toString('hex');
    await db.recoveryCode.create({ data: { userId: a.userId, codeHash: createHash('sha256').update(legacy).digest('hex') } });
    assert.equal(await verifyLogin(a.userId, `${legacy.slice(0, 5)}-${legacy.slice(5)}`), true);
    assert.equal(await verifyLogin(a.userId, legacy), false);
  });
});
