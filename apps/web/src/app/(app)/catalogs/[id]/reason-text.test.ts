import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appDict } from '@tasnivo/i18n/i18n-app';
import { reasonLines } from './reason-text.js';
import type { ReasonFacts } from './ws-types';

/** The API's unit labels (domain unit-label.ts) for the one unit these cases use. */
const unitLabel = (locale: 'uz' | 'ru', u: string): string => (locale === 'ru' && u === 'dona' ? 'шт' : u);

const facts: ReasonFacts = { code: '00401001001099999', retired: false, afterUpdate: false, rowUnit: 'litr', requiredUnits: [], purchasedOtherUnit: false, privilegeMismatch: false, restriction: null, tnved: null };
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
    const restriction = { code: '02523001001000000', date: '01.07.2026', inForce: true };
    for (const type of ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT', 'NOT_PURCHASED', 'PRIVILEGE_CODE', 'PRIVILEGE_OPPORTUNITY', 'RESTRICTED']) {
      const lines = reasonLines({ type, facts: { ...facts, requiredUnits: ['dona'], retired: true, afterUpdate: true, rowUnit: null, restriction }, noSuggestion: true }, ru, unit);
      assert.ok(lines.length > 0, type);
      // mkinfo.uz is a site name, the same in every language.
      for (const line of lines) assert.equal(latin.test(line.replace(/\d+/g, '').replace('mkinfo.uz', '')), false, `${type}: ${line}`);
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

  it('give a restricted code\'s date, and where to ask when its position has no detailed code', () => {
    const restriction = { code: '02523001001000000', date: '01.07.2026', inForce: false };
    const soon = reasonLines({ type: 'RESTRICTED', facts: { ...facts, restriction }, noSuggestion: false }, uz, String);
    assert.deepEqual(soon, [uz.explain['RESTRICTED'], uz.reason.restricted('02523001001000000', '01.07.2026', false)]);
    assert.match(soon[1] ?? '', /01\.07\.2026 dan 02523001001000000 kodidan EHFda foydalanish cheklanadi/);
    const none = reasonLines({ type: 'RESTRICTED', facts: { ...facts, restriction: { ...restriction, inForce: true } }, noSuggestion: true }, ru, String);
    assert.deepEqual(none.slice(1), [ru.reason.restricted('02523001001000000', '01.07.2026', true), ru.reason.restrictedNone]);
    assert.match(none.join(' '), /ограничено.*mkinfo\.uz/);
  });

  it('name the row\'s TN VED and both headings, and say what to do when the heading had no code', () => {
    const tnved = { code: '7304390000', heading: '7304', codeHeading: '7306' };
    const lines = reasonLines({ type: 'TNVED_MISMATCH', facts: { ...facts, tnved }, noSuggestion: false }, uz, String);
    assert.deepEqual(lines, [uz.explain['TNVED_MISMATCH'], uz.reason.tnved('7304390000', '7304', '7306')]);
    const none = reasonLines({ type: 'TNVED_MISMATCH', facts: { ...facts, tnved }, noSuggestion: true }, ru, String);
    assert.deepEqual(none.slice(1), [ru.reason.tnved('7304390000', '7304', '7306'), ru.reason.tnvedNone]);
    assert.match(none[1] ?? '', /ТН ВЭД/);
  });

  it('use the dictionary term for the classifier', () => {
    for (const text of [uz.explain['NOT_FOUND'], uz.reason.notFoundRetired('X'), uz.reason.restrictedNone]) assert.equal(/klassifikator/i.test(text ?? ''), false);
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
