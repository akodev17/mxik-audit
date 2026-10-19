import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ActivityRow } from '@/lib/activity';
import { groupDecisions } from '@/lib/activity-groups';
import { appDict } from '@/lib/i18n-app';
import { actorText, entryTitle, isAutomaticEntry } from './entry-text';

const base = new Date('2026-10-20T10:00:00Z').getTime();
let n = 0;
const row = (action: string, minutesAgo: number, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  id: `e${(n += 1)}`, action, at: new Date(base - minutesAgo * 60_000), actorId: 'u1', actor: 'a@x.uz',
  catalogId: 'c1', catalogName: 'baraka.xlsx', catalogDeleted: false, clientId: 'k1', clientName: 'Baraka', count: null, product: null,
  ...extra,
});
const system = { actorId: null, actor: null };

describe('automatic decisions in the activity log', () => {
  const ta = appDict('uz');

  it('folds a run of automatic decisions under its own title, apart from a person’s run', () => {
    const entries = groupDecisions([
      row('finding.accepted', 0),
      row('finding.accepted', 1),
      row('finding.auto_accepted', 2, { ...system, count: 7 }),
      row('finding.carried_over', 3, { ...system, count: 5 }),
    ]);
    assert.equal(entries.length, 2);
    const [human, auto] = entries;
    assert.ok(human && auto);
    assert.equal(isAutomaticEntry(human), false);
    assert.equal(isAutomaticEntry(auto), true);
    assert.equal(entryTitle(auto, ta, 'uz'), 'Avtomatik: 12 ta qaror — baraka.xlsx');
    assert.equal(entryTitle(human, ta, 'uz'), '2 ta qaror — baraka.xlsx');
  });

  it('names the actor of an automatic decision as automatic, not as a person or the system', () => {
    assert.equal(actorText(row('finding.auto_accepted', 0, system), ta), ta.firmX.log.automatic);
    assert.equal(actorText(row('classifier.updated', 0, system), ta), ta.firmX.log.system);
    assert.equal(actorText(row('finding.accepted', 0, { actor: null }), ta), ta.firmX.log.deletedUser);
  });
});
