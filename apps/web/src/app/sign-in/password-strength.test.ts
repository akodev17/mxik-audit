import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { passwordStrength } from './password-strength.js';

describe('password strength hint', () => {
  it('is empty for nothing and weak below the minimum or for the usual suspects', () => {
    assert.equal(passwordStrength('', 8), 0);
    assert.equal(passwordStrength('Ab1!', 8), 1);
    assert.equal(passwordStrength('password1', 8), 1);
    assert.equal(passwordStrength('12345678', 8), 1);
    assert.equal(passwordStrength('aaaaaaaaaaaa', 8), 1);
  });

  it('grows with length and with mixed kinds of characters', () => {
    assert.equal(passwordStrength('buxgalter', 8), 1);
    assert.equal(passwordStrength('buxgalter7', 8), 2);
    assert.equal(passwordStrength('Buxgalter7', 8), 3);
    assert.equal(passwordStrength('Buxgalter-2026!', 8), 4);
    assert.equal(passwordStrength('бухгалтерия-ташкент', 8), 4);
  });
});
