import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bannerLines, joinSentences } from './plan-banner-lines';

const plan = (over: Partial<Parameters<typeof bannerLines>[0]>): Parameters<typeof bannerLines>[0] =>
  ({ state: 'firm', daysLeft: 30, warnings: [], full: [], ...over });

describe('plan banner', () => {
  it('stays hidden while nothing needs a look', () => {
    assert.equal(bannerLines(plan({})), null);
    assert.equal(bannerLines(plan({ state: 'unlimited', daysLeft: null })), null);
    assert.equal(bannerLines(plan({ daysLeft: 8 })), null);
  });

  it('warns about a trial or subscription ending within a week on its own', () => {
    assert.deepEqual(bannerLines(plan({ state: 'trial', daysLeft: 7 })), { tone: 'warn', lines: [{ kind: 'trialEnds', days: 7 }] });
    assert.deepEqual(bannerLines(plan({ daysLeft: 0 })), { tone: 'warn', lines: [{ kind: 'subscriptionEnds', days: 0 }] });
  });

  it('shows a near limit and the coming expiry together, the limit first', () => {
    assert.deepEqual(bannerLines(plan({ daysLeft: 3, warnings: ['seats'] })), {
      tone: 'warn',
      lines: [{ kind: 'warn', keys: ['seats'] }, { kind: 'subscriptionEnds', days: 3 }],
    });
    assert.deepEqual(bannerLines(plan({ state: 'trial', daysLeft: 2, warnings: ['clients', 'rowsPerMonth'] }))?.lines.map((l) => l.kind), ['warn', 'trialEnds']);
  });

  it('keeps a full limit first and in danger tone, still adding the expiry', () => {
    assert.deepEqual(bannerLines(plan({ daysLeft: 5, full: ['clients'], warnings: ['seats'] })), {
      tone: 'danger',
      lines: [{ kind: 'full', keys: ['clients'] }, { kind: 'subscriptionEnds', days: 5 }],
    });
    assert.deepEqual(bannerLines(plan({ full: ['seats'] })), { tone: 'danger', lines: [{ kind: 'full', keys: ['seats'] }] });
  });

  it('says only that the plan has expired once it has', () => {
    assert.deepEqual(bannerLines(plan({ state: 'expired', daysLeft: 0, full: ['clients'] })), { tone: 'danger', lines: [{ kind: 'expired' }] });
  });

  it('joins the phrases into sentences without doubling a stop', () => {
    assert.equal(joinSentences(['Chegaraga yaqinlashdingiz: foydalanuvchilar', 'Obuna muddati: 3 kun qoldi']), 'Chegaraga yaqinlashdingiz: foydalanuvchilar. Obuna muddati: 3 kun qoldi');
    assert.equal(joinSentences(['Done.', 'Next']), 'Done. Next');
    assert.equal(joinSentences(['Only']), 'Only');
  });
});
