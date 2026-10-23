import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appDict } from '../i18n-app';
import { ru, TOUR_STEP_KEYS, uz } from './tour';

/** Every string leaf with its path; functions are called with sample numbers. */
function leaves(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  if (typeof value === 'function') return [[path, String((value as (a: number, b: number) => unknown)(3, 14))]];
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}

describe('tour dictionary', () => {
  it('has the same keys in the same order in both languages', () => {
    assert.deepEqual(leaves(ru).map(([p]) => p), leaves(uz).map(([p]) => p));
  });

  it('has exactly the fourteen steps of the engine, in order', () => {
    assert.deepEqual(Object.keys(uz.tourX.steps), [...TOUR_STEP_KEYS]);
    assert.deepEqual(Object.keys(ru.tourX.steps), [...TOUR_STEP_KEYS]);
  });

  it('uses no ASCII or typographic quote as an apostrophe', () => {
    for (const [path, text] of leaves(uz)) assert.doesNotMatch(text, /['`‘’]/, `uz ${path}`);
    for (const [path, text] of leaves(ru)) assert.doesNotMatch(text, /['`‘’]/, `ru ${path}`);
  });

  it('keeps every step body to two short sentences without jargon', () => {
    for (const dict of [uz, ru]) {
      for (const [key, step] of Object.entries(dict.tourX.steps)) {
        assert.ok(step.title.trim() && step.body.trim(), key);
        assert.ok(step.body.length <= 160, `${key}: ${step.body.length} chars`);
        assert.ok((step.body.match(/[.!?](?=\s|$)/g) ?? []).length <= 2, `${key}: at most two sentences`);
        assert.doesNotMatch(step.body, /integrats|sinxroniz|интеграц|синхрониз|parser|парсер|odata|\bapi\b/i, key);
      }
    }
  });

  it('names each section with the label the app shows for it', () => {
    for (const locale of ['uz', 'ru'] as const) {
      const ta = appDict(locale);
      const steps = ta.tourX.steps;
      assert.equal(steps.dashboard.title, ta.nav.dashboard);
      assert.equal(steps.upload.title, ta.shellX.nav.upload);
      assert.equal(steps.catalogs.title, ta.nav.catalogs);
      assert.equal(steps.queue.title, ta.shellX.nav.queue);
      assert.equal(steps.clients.title, ta.nav.clients);
      assert.equal(steps.products.title, ta.accountingX.nav.products);
      assert.equal(steps.bank.title, ta.accountingX.nav.bank);
      assert.equal(steps.didox.title, ta.accountingX.nav.didox);
      assert.equal(steps.onec.title, ta.accountingX.nav.onec);
      assert.equal(steps.dictionary.title, ta.nav.dictionary);
      assert.equal(steps.activity.title, ta.nav.activity);
      assert.ok(steps.settings.title.startsWith(ta.nav.settings), locale);
    }
  });

  it('counts steps the same way in both languages', () => {
    assert.equal(uz.tourX.counter(3, 14), '3 / 14');
    assert.equal(ru.tourX.counter(3, 14), '3 / 14');
  });
});
