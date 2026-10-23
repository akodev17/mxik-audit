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

  it('labels every card feature line in both languages, short enough to scan (at most six words, no sentence)', () => {
    assert.deepEqual(Object.keys(ru.prX.features), Object.keys(uz.prX.features));
    for (const dict of [uz, ru]) {
      for (const [id, label] of Object.entries(dict.prX.features)) {
        assert.ok(label.trim(), id);
        assert.ok(label.split(/\s+/).length <= 6, `${id}: ${label}`);
        assert.doesNotMatch(label, /\.$/, `${id} ends without a full stop`);
      }
    }
    assert.equal(uz.prX.notInPlan(uz.prX.features.reminders), '«Oylik eslatmalar» joriy tarifingizga kirmaydi. Tarifni Sozlamalar → Tarif boʻlimida oʻzgartirish mumkin.');
  });

  it('is part of the app dictionary in both languages', () => {
    assert.equal(appDict('uz').prX.names.company, 'Korxona');
    assert.equal(appDict('ru').prX.names.company, 'Предприятие');
    assert.equal(appDict('uz').prX.trialTerm(14), '14 kun, karta kerak emas');
    assert.equal(appDict('ru').prX.trialTerm(14), '14 дней, без карты');
    assert.equal(appDict('ru').prX.trialTerm(21), '21 день, без карты');
  });
});
