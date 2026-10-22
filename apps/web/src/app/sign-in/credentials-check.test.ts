import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MIN_PASSWORD } from '../../lib/security/password-check.js';
import { checkCredentials, hasIssues, MIN_PASSWORD_LENGTH } from './credentials-check.js';

describe('sign-in and sign-up field checks', () => {
  it('uses the server minimum password length', () => {
    assert.equal(MIN_PASSWORD_LENGTH, MIN_PASSWORD);
  });

  it('asks for a missing or malformed address and a missing password', () => {
    assert.deepEqual(checkCredentials('', '', null), { email: 'required', password: 'required' });
    assert.deepEqual(checkCredentials('  ', 'x', null), { email: 'required' });
    assert.deepEqual(checkCredentials('nobody@', 'x', null), { email: 'bad' });
    assert.deepEqual(checkCredentials(' a@b.uz ', 'x', null), {});
    assert.equal(hasIssues(checkCredentials('a@b.uz', 'x', null)), false);
  });

  it('checks the length only when a minimum is given (sign-up)', () => {
    assert.deepEqual(checkCredentials('a@b.uz', 'short', MIN_PASSWORD_LENGTH), { password: 'short' });
    assert.deepEqual(checkCredentials('a@b.uz', 'long enough', MIN_PASSWORD_LENGTH), {});
  });
});
