import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ActivityRow } from './activity.js';
import { groupDecisions } from './activity-groups.js';

const base = new Date('2026-10-20T10:00:00Z').getTime();
let n = 0;
const row = (action: string, minutesAgo: number, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  id: `e${(n += 1)}`, action, at: new Date(base - minutesAgo * 60_000), actorId: 'u1', actor: 'a@x.uz',
  catalogId: 'c1', catalogName: 'baraka.xlsx', catalogDeleted: false, clientId: 'k1', clientName: 'Baraka', count: null, product: null,
  ...extra,
});

describe('folding decision runs in the activity log', () => {
  it('folds consecutive decisions by one person on one catalogue and counts bulk rows', () => {
    const entries = groupDecisions([
      row('finding.accepted', 0),
      row('finding.rejected', 2),
      row('finding.bulk_accepted', 5, { count: 10 }),
      row('catalog.exported', 6),
      row('finding.accepted', 7),
    ]);
    assert.deepEqual(entries.map((e) => e.kind), ['group', 'event', 'event']);
    const group = entries[0];
    assert.ok(group?.kind === 'group');
    assert.equal(group.decisions, 12);
    assert.equal(group.rows.length, 3);
    assert.equal(group.last.getTime(), base);
    assert.equal(group.first.getTime(), base - 5 * 60_000);
  });

  it('splits on another person, another catalogue, an undo, or a long pause', () => {
    const kinds = (rows: ActivityRow[]) => groupDecisions(rows).map((e) => (e.kind === 'group' ? e.rows.length : 1));
    assert.deepEqual(kinds([row('finding.accepted', 0), row('finding.accepted', 1, { actorId: 'u2' })]), [1, 1]);
    assert.deepEqual(kinds([row('finding.accepted', 0), row('finding.accepted', 1, { catalogId: 'c2' })]), [1, 1]);
    assert.deepEqual(kinds([row('finding.accepted', 0), row('finding.undone', 1), row('finding.accepted', 2)]), [1, 1, 1]);
    assert.deepEqual(kinds([row('finding.accepted', 0), row('finding.accepted', 45)]), [1, 1]);
    assert.deepEqual(kinds([row('finding.accepted', 0, { catalogId: null }), row('finding.accepted', 1, { catalogId: null })]), [1, 1]);
  });
});
