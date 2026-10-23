import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fmtDateTime } from '@tasnivo/i18n/format';
import { groupByDay, timeOfDay } from './day-groups';
import { parseRecent, RECENT_MAX, withRecent, type RecentItem } from './palette-recent';
import { skeletonKind } from './skeleton-kind';

describe('timeline day groups', () => {
  // 23 Oct 2026, 10:00 in Tashkent (UTC+5).
  const now = new Date('2026-10-23T05:00:00Z');
  const at = (iso: string) => ({ at: iso });

  it('groups by Tashkent calendar day and names today and yesterday', () => {
    const groups = groupByDay([
      at('2026-10-23T04:00:00Z'), // 09:00 today
      at('2026-10-22T19:30:00Z'), // 00:30 today in Tashkent, still the 22nd in UTC
      at('2026-10-22T18:00:00Z'), // 23:00 yesterday
      at('2026-10-20T10:00:00Z'),
    ], (x) => x.at, now);
    assert.deepEqual(groups.map((g) => [g.day, g.name, g.items.length]), [
      ['2026-10-23', 'today', 2],
      ['2026-10-22', 'yesterday', 1],
      ['2026-10-20', null, 1],
    ]);
    assert.deepEqual(groupByDay([], (x: { at: string }) => x.at, now), []);
  });

  it('prints the time of a formatted date-time', () => {
    assert.equal(timeOfDay(fmtDateTime('uz', '2026-10-23T04:05:00Z')), '09:05');
  });
});

describe('palette recent items', () => {
  const item = (id: string): RecentItem => ({ kind: 'client', id, label: `Client ${id}`, href: `/clients/${id}` });

  it('keeps the newest first, once each, at most six', () => {
    let list: RecentItem[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) list = withRecent(list, item(id));
    assert.equal(list.length, RECENT_MAX);
    assert.deepEqual(list.map((x) => x.id), ['g', 'f', 'e', 'd', 'c', 'b']);
    assert.deepEqual(withRecent(list, item('d')).map((x) => x.id), ['d', 'g', 'f', 'e', 'c', 'b']);
  });

  it('reads back only well-formed items with addresses inside the app', () => {
    const raw = JSON.stringify([
      item('a'),
      { kind: 'catalog', id: 'k', label: 'x.xlsx', detail: 'Baraka', href: '/catalogs/k' },
      { kind: 'client', id: 'evil', label: 'Evil', href: 'https://evil.example' },
      { kind: 'client', id: 'evil2', label: 'Evil', href: '//evil.example' },
      { kind: 'unknown', id: 'x', label: 'x', href: '/x' },
      'junk',
    ]);
    assert.deepEqual(parseRecent(raw).map((x) => x.id), ['a', 'k']);
    assert.deepEqual(parseRecent('not json'), []);
    assert.deepEqual(parseRecent(null), []);
  });
});

describe('route skeletons', () => {
  it('picks the placeholder shaped like the page being opened', () => {
    assert.equal(skeletonKind('/dashboard'), 'dashboard');
    assert.equal(skeletonKind('/catalogs'), 'list');
    assert.equal(skeletonKind('/catalogs/abc'), 'workspace');
    assert.equal(skeletonKind('/catalogs/abc/report'), 'list');
    assert.equal(skeletonKind('/clients/abc'), 'record');
    assert.equal(skeletonKind('/settings'), 'settings');
    assert.equal(skeletonKind('/upload'), 'upload');
    assert.equal(skeletonKind('/notifications'), 'list');
    assert.equal(skeletonKind('/somewhere'), 'page');
  });
});
