import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appDict } from '@/lib/i18n-app';
import type { ReasonFacts } from '@/lib/row-detail-parts';
import { reasonLines } from './reason-text.js';
import { unitLabel } from './unit-label.js';

const facts: ReasonFacts = { code: '00401001001099999', retired: false, afterUpdate: false, rowUnit: 'litr', requiredUnits: [], purchasedOtherUnit: false, privilegeMismatch: false };
const uz = appDict('uz').wsX;
const ru = appDict('ru').wsX;
const latin = /[a-zʻ]{3,}/i;

describe('reason lines', () => {
  it('start with the check in the viewer\'s language and never repeat it', () => {
    const lines = reasonLines({ type: 'MISSING', facts, noSuggestion: false }, uz, (u) => unitLabel('uz', u));
    assert.deepEqual(lines, [uz.explain['MISSING']]);
  });

  it('read wholly in Russian for a Russian viewer', () => {
    const unit = (u: string): string => unitLabel('ru', u);
    for (const type of ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT', 'NOT_PURCHASED', 'PRIVILEGE_CODE', 'PRIVILEGE_OPPORTUNITY']) {
      const lines = reasonLines({ type, facts: { ...facts, requiredUnits: ['dona'], retired: true, afterUpdate: true, rowUnit: null }, noSuggestion: true }, ru, unit);
      assert.ok(lines.length > 0, type);
      for (const line of lines) assert.equal(latin.test(line.replace(/\d+/g, '')), false, `${type}: ${line}`);
    }
  });

  it('give the units of a unit conflict, the code\'s one localized', () => {
    const lines = reasonLines({ type: 'UNIT_CONFLICT', facts: { ...facts, requiredUnits: ['dona'] }, noSuggestion: false }, ru, (u) => unitLabel('ru', u));
    assert.equal(lines[1], ru.reason.unit('litr', 'шт'));
  });

  it('say when the code was retired, bought in another unit, or found after an update', () => {
    assert.ok(reasonLines({ type: 'NOT_FOUND', facts: { ...facts, retired: true }, noSuggestion: false }, uz, String).includes(uz.reason.notFoundRetired('00401001001099999')));
    const purchase = reasonLines({ type: 'NOT_PURCHASED', facts: { ...facts, purchasedOtherUnit: true }, noSuggestion: false }, uz, String);
    assert.deepEqual(purchase.slice(1), [uz.reason.purchasedOtherUnit('litr'), uz.reason.purchaseNote]);
    assert.equal(reasonLines({ type: 'MISMATCH', facts: { ...facts, afterUpdate: true }, noSuggestion: false }, uz, String).at(-1), uz.reason.afterUpdate);
  });

  it('weigh a privilege by whether the code fits the name', () => {
    assert.equal(reasonLines({ type: 'PRIVILEGE_CODE', facts: { ...facts, privilegeMismatch: true }, noSuggestion: true }, uz, String)[1], uz.reason.privilegeMismatch);
    assert.equal(reasonLines({ type: 'PRIVILEGE_CODE', facts, noSuggestion: true }, uz, String)[1], uz.reason.privilegeCheck);
  });

  it('use the dictionary term for the classifier', () => {
    for (const text of [uz.explain['NOT_FOUND'], uz.reason.notFoundRetired('X')]) assert.equal(/klassifikator/i.test(text ?? ''), false);
  });
});

describe('Russian bulk wording', () => {
  it('agrees the verb with the count and declines the noun', () => {
    assert.equal(ru.bulk.dryRun('1', 1), 'Изменится 1 непроверенная проблема');
    assert.equal(ru.bulk.dryRun('3', 3), 'Изменятся 3 непроверенные проблемы');
    assert.equal(ru.bulk.dryRun('5', 5), 'Изменятся 5 непроверенных проблем');
    assert.match(ru.bulk.capped('20 000', '1 001', 1001), /^В фильтре 1 001 проблема;/);
    assert.match(ru.bulk.capped('20 000', '22', 22), /^В фильтре 22 проблемы;/);
  });
});
