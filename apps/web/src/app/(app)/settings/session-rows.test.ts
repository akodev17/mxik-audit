import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agoLabel } from './session-rows.js';

const at = (iso: string): Date => new Date(iso);

describe('sessions list', () => {
  it('says how long ago a session was active, in both languages', () => {
    const now = at('2026-10-19T12:00:00Z');
    assert.equal(agoLabel('uz', at('2026-10-19T11:59:30Z'), now), 'hozir');
    assert.equal(agoLabel('uz', '2026-10-19T11:55:00.000Z', now), '5 daqiqa oldin');
    assert.equal(agoLabel('ru', at('2026-10-19T09:00:00Z'), now), '3 часа назад');
    assert.equal(agoLabel('ru', at('2026-10-07T12:00:00Z'), now), '12 дней назад');
    assert.equal(agoLabel('uz', at('2026-08-01T12:00:00Z'), now), null);
  });
});
