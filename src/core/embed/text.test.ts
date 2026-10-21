import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeName } from '../normalize/index.js';
import { embeddingText } from './text.js';

describe('embeddingText', () => {
  it('folded: the pipeline query and the folded name, exactly as before 2026-10-22', () => {
    const n = normalizeName('Трубы эл/св 57х3,0');
    assert.equal(embeddingText('Трубы эл/св 57х3,0', 'query', 'folded'), n.queryKey);
    assert.equal(embeddingText('Trubalar va quvurlar', 'passage', 'folded'), 'trubalar va quvurlar');
  });

  it('natural: keeps script and case, expands trade abbreviations and drops pack noise for a row', () => {
    const q = embeddingText('Трубы эл/св 57х3,0', 'query', 'natural');
    assert.match(q, /^Трубы электросварные/);
    assert.doesNotMatch(q, /эл\/св/);
    assert.equal(embeddingText("Choy qora 100 gr", 'query', 'natural').includes('100 gr'), false);
  });

  it('natural: a classifier name stays as written, apostrophes normalised and spaces squeezed', () => {
    assert.equal(embeddingText('Трубы  стальные электросварные', 'passage', 'natural'), 'Трубы стальные электросварные');
    assert.equal(embeddingText("Yog'och taxta", 'passage', 'natural'), 'Yogʻoch taxta');
  });

  it('never returns an empty row text when the name has a word', () => {
    assert.notEqual(embeddingText('500 мл', 'query', 'natural'), '');
  });
});
