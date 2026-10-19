import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withQuery } from './query-string.js';
import { agoText, daysSince } from './relative-day.js';

const words = { today: 'today', yesterday: 'yesterday', days: (n: number) => `${n}d`, months: (n: number) => `${n}mo` };

describe('relative days and list links', () => {
  it('counts Tashkent calendar days, not 24-hour spans', () => {
    const now = new Date('2026-10-20T04:00:00Z'); // 09:00 in Tashkent
    assert.equal(daysSince(new Date('2026-10-19T20:00:00Z'), now), 0); // 01:00 the same local day
    assert.equal(daysSince(new Date('2026-10-19T18:00:00Z'), now), 1); // 23:00 the day before
    assert.equal(daysSince(new Date('2026-10-25T00:00:00Z'), now), 0);
  });

  it('says today, yesterday, days and then months', () => {
    assert.equal(agoText(words, 0), 'today');
    assert.equal(agoText(words, 1), 'yesterday');
    assert.equal(agoText(words, 12), '12d');
    assert.equal(agoText(words, 95), '3mo');
  });

  it('keeps filters while changing one, and drops empty values', () => {
    assert.equal(withQuery('/clients', { q: 'bar', filter: 'stale', page: '3' }, { page: null }), '/clients?q=bar&filter=stale');
    assert.equal(withQuery('/clients', { q: '', filter: undefined }, { sort: 'name' }), '/clients?sort=name');
    assert.equal(withQuery('/queue', {}), '/queue');
  });
});
