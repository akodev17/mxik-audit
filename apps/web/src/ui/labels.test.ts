import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dict } from '@tasnivo/i18n/i18n';
import { appDict } from '@tasnivo/i18n/i18n-app';
import { confidenceView, suggestionLabel } from './labels.js';

const t = dict('uz');
const ta = appDict('uz');

describe('confidence wording', () => {
  it('never words a match score as certainty or probability', () => {
    for (const locale of ['uz', 'ru'] as const) {
      const d = dict(locale);
      for (const word of [d.confidenceSure, d.confidenceLikely, d.confidenceCheck]) {
        assert.doesNotMatch(word, /^(Aniq|Ehtimoliy|Точно|Вероятно)$/);
      }
    }
    assert.equal(t.confidenceSure, 'Yuqori moslik');
    assert.equal(dict('ru').confidenceLikely, 'Среднее совпадение');
  });
});

describe('suggestionLabel', () => {
  it('names barcode and dictionary sources', () => {
    assert.equal(suggestionLabel(t, ta, { confidence: 1, stage: 'barcode' })?.label, 'Shtrix-kod boʻyicha');
    assert.equal(suggestionLabel(t, ta, { confidence: 0.96, stage: 'dictionary' })?.label, 'Firma lugʻatidan');
    assert.equal(suggestionLabel(dict('ru'), appDict('ru'), { confidence: 1, stage: 'barcode' })?.label, 'По штрихкоду');
  });

  it('gives the score band otherwise, with tones that match the bands', () => {
    assert.deepEqual(suggestionLabel(t, ta, { confidence: 0.93, stage: 'rerank' }), { key: 'sure', label: 'Yuqori moslik', tone: 'good', percent: 93 });
    assert.equal(suggestionLabel(t, ta, { confidence: 0.8 })?.label, 'Oʻrtacha moslik');
    assert.deepEqual(suggestionLabel(t, ta, { confidence: 0.3 }), { key: 'check', label: 'Past moslik', tone: 'neutral', percent: 30 });
    assert.equal(suggestionLabel(dict('ru'), appDict('ru'), { confidence: 0.74 })?.label, 'Низкое совпадение');
    assert.equal(suggestionLabel(t, ta, { confidence: null }), null);
  });
});

describe('confidenceView', () => {
  it('keeps its signature and uses the new wording', () => {
    assert.deepEqual(confidenceView(t, 0.91, false), { label: 'Yuqori moslik', tone: 'good', percent: 91 });
    assert.equal(confidenceView(t, 0.2, true)?.label, 'Yuqori moslik');
    assert.equal(confidenceView(t, null, false), null);
  });
});
