import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appDict } from '../i18n-app';
import { ru, uz } from './pricing';

const PLANS = ['trial', 'company', 'accountant', 'firm'] as const;

describe('pricing dictionary', () => {
  it('names every plan and says who it is for, in both languages', () => {
    for (const dict of [uz, ru]) {
      for (const plan of PLANS) {
        assert.ok(dict.prX.names[plan]?.trim(), `name of ${plan}`);
        assert.ok(dict.prX.who[plan]?.trim(), `who of ${plan}`);
      }
      assert.equal(new Set(PLANS.map((p) => dict.prX.names[p])).size, PLANS.length, 'names are distinct');
    }
  });

  it('avoids the generic names the owner asked to drop', () => {
    for (const dict of [uz, ru]) {
      for (const plan of PLANS) assert.doesNotMatch(dict.prX.names[plan], /free|basic|pro|business|бизнес|базов/i);
    }
  });

  it('keeps numbers out of the copy (they come from the plans)', () => {
    for (const dict of [uz, ru]) {
      for (const plan of PLANS) assert.doesNotMatch(dict.prX.who[plan], /\d/);
      assert.doesNotMatch(dict.prX.lead, /\d/);
    }
  });

  it('describes every all-plans feature with a name and a sentence, the same features in both languages', () => {
    const features = (dict: typeof uz) => Object.values(dict.prX.everywhere.groups).flatMap((g) => Object.entries(g.items));
    assert.deepEqual(features(ru).map(([id]) => id), features(uz).map(([id]) => id));
    for (const dict of [uz, ru]) {
      for (const [id, item] of features(dict)) {
        assert.ok(item.name.trim(), `${id} name`);
        assert.match(item.text, /\.$/, `${id} is a sentence`);
      }
    }
  });

  it('is part of the app dictionary in both languages', () => {
    assert.equal(appDict('uz').prX.names.company, 'Korxona');
    assert.equal(appDict('ru').prX.names.company, 'Предприятие');
    assert.equal(appDict('uz').prX.trialTerm(14), '14 kun, karta kerak emas');
    assert.equal(appDict('ru').prX.trialTerm(14), '14 дней, без карты');
    assert.equal(appDict('ru').prX.trialTerm(21), '21 день, без карты');
  });
});
