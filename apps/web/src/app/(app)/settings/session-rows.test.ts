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

  it('B3: Uzbek never goes through Intl (browsers lack Uzbek data) and never shows a minus', () => {
    const now = at('2026-10-19T12:00:00Z');
    assert.equal(agoLabel('uz', at('2026-10-19T11:59:00Z'), now), '1 daqiqa oldin');
    assert.equal(agoLabel('uz', at('2026-10-18T17:00:00Z'), now), '19 soat oldin');
    assert.equal(agoLabel('uz', at('2026-10-18T11:00:00Z'), now), 'kecha');
    assert.equal(agoLabel('uz', at('2026-10-12T12:00:00Z'), now), '7 kun oldin');
    assert.equal(agoLabel('uz', at('2026-10-19T12:05:00Z'), now), 'hozir', 'a clock a little ahead is "now"');
    const original = Intl.RelativeTimeFormat;
    // A browser without Uzbek data: the root locale's "-1 min" must not reach the page.
    Reflect.set(Intl, 'RelativeTimeFormat', function () { throw new Error('Intl used for uz'); });
    try {
      for (const m of [0, 1, 59, 60, 23 * 60, 24 * 60, 29 * 24 * 60]) {
        const label = agoLabel('uz', new Date(now.getTime() - m * 60_000), now) ?? '';
        assert.ok(!label.startsWith('-'), label);
      }
    } finally {
      Reflect.set(Intl, 'RelativeTimeFormat', original);
    }
  });
});
