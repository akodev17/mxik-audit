import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appDict } from '@tasnivo/i18n/i18n-app';
import { rateLimitOf } from './rate-limit.js';

describe('sign-in rate-limit notice', () => {
  for (const locale of ['uz', 'ru'] as const) {
    const m = appDict(locale).secX;

    it(`recognises both throttle messages with their minutes (${locale})`, () => {
      assert.deepEqual(rateLimitOf(m.tooMany(15), m), { kind: 'ip', minutes: 15 });
      assert.deepEqual(rateLimitOf(m.passwordCooldown(1), m), { kind: 'account', minutes: 1 });
      assert.deepEqual(rateLimitOf(m.passwordCooldown(42), m), { kind: 'account', minutes: 42 });
    });

    it(`leaves every other message alone (${locale})`, () => {
      assert.equal(rateLimitOf(null, m), null);
      assert.equal(rateLimitOf('', m), null);
      assert.equal(rateLimitOf(appDict(locale).secX.required.password, m), null);
      assert.equal(rateLimitOf(`${m.tooMany(5)} `, m), null);
    });
  }
});
