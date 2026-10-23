import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appDict } from '@tasnivo/i18n/i18n-app';
import { groupDecisions, type ActivityRow } from '@/lib/pure/activity-groups';
import { actorText, codeParts, entryKind, entryTitle, isAutomaticEntry } from './entry-text';

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

describe('activity entry text', () => {
  it('splits 17-digit classifier codes out of a text, and only those', () => {
    assert.deepEqual(codeParts('Kod 10101001001000000 qabul qilindi'), [
      { text: 'Kod ', code: false }, { text: '10101001001000000', code: true }, { text: ' qabul qilindi', code: false },
    ]);
    assert.deepEqual(codeParts('Shtrix-kod 4780000000017'), [{ text: 'Shtrix-kod 4780000000017', code: false }]);
    assert.deepEqual(codeParts(''), [{ text: '', code: false }]);
  });

  it('marks each action with its kind', () => {
    assert.equal(entryKind('finding.accepted'), 'decision');
    assert.equal(entryKind('catalog.uploaded'), 'upload');
    assert.equal(entryKind('catalog.pdf_exported'), 'export');
    assert.equal(entryKind('account.exported'), 'export');
    assert.equal(entryKind('review.assigned'), 'client');
    assert.equal(entryKind('security.2fa_enabled'), 'team');
    assert.equal(entryKind('something.new'), 'other');
  });
});
