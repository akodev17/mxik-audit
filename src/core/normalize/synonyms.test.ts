import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeName } from './index.js';
import { applySynonyms, SYNONYMS } from './synonyms.js';

/** The lexical query the pipeline builds for a row name, before fragments are dropped. */
const query = (name: string): string => normalizeName(name).queryKey;

describe('applySynonyms', () => {
  it('reads rebar as the classifier names it, in both scripts', () => {
    for (const name of ['Арматура А500С ф12', 'Armatura 14 mm', 'Арматура 10-12', 'Арм. 12']) {
      const r = applySynonyms(query(name));
      assert.match(r.text, /\bprokat armaturniy\b/, name);
      assert.doesNotMatch(r.text, /\barmatura\b/, `${name}: the ambiguous word is replaced`);
      assert.deepEqual(r.applied, ['арматура → прокат арматурный']);
    }
  });

  it('leaves pipe fittings alone: "арматура" next to a pipe, valve or plastic word', () => {
    for (const name of ['Арматура для труб ПП', 'Арматура запорная', 'Кран шаровой арматура', 'Plastik quvur armatura', 'Арматура смывная для бачка']) {
      const r = applySynonyms(query(name));
      assert.doesNotMatch(r.text, /prokat/, name);
      assert.ok(!r.applied.some((a) => a.startsWith('арматура')), name);
    }
  });

  it('adds the classifier wording for angle steel and keeps the seller word', () => {
    const r = applySynonyms(query('Уголок 50х50х5'));
    assert.equal(r.text, 'ugolok ugloviye profili uglovaya stal');
  });

  it('replaces "минвата", which no classifier name uses', () => {
    assert.equal(applySynonyms(query('Минвата Rockwool 50мм')).text, 'mineralnaya vata rockwool');
  });

  it('adds the insulation and block terms beside the seller word', () => {
    assert.match(applySynonyms(query('Утеплитель базальтовый')).text, /^uteplitel teploizolyatsionniye bazaltoviy$/);
    assert.match(applySynonyms(query('Газоблок D500')).text, /gazoblok gazosilikatniye bloki/);
    assert.match(applySynonyms(query('Пеноблок D600')).text, /penoblok penobetonniy blok/);
    assert.match(applySynonyms(query('Керамзитоблок 390х190х188')).text, /keramzitoblok keramzitniy blok/);
  });

  it('spells out polypropylene for ПП and PPR, before short fragments are dropped', () => {
    assert.match(applySynonyms(query('Труба ПП PN20 25мм')).text, /\bpolipropilenoviye\b/);
    assert.match(applySynonyms(query('Truba PPR 20 mm')).text, /\bpolipropilenoviye\b/);
  });

  it('changes nothing, and reports nothing, for a name without a synonym', () => {
    assert.deepEqual(applySynonyms(query('Лист г/к 2,0х1250х2500')), { text: query('Лист г/к 2,0х1250х2500'), applied: [], added: [] });
  });

  it('fires each entry once and never repeats a word already in the query', () => {
    const r = applySynonyms('ugolok ugolok profili');
    // The term follows the first trigger; "profili" was already there.
    assert.equal(r.text, 'ugolok ugloviye uglovaya stal ugolok profili');
    assert.equal(r.applied.length, 1);
    assert.deepEqual(r.added, ['ugloviye', 'uglovaya', 'stal']);
  });

  it('never changes the normalised name itself, only the lexical query', () => {
    const n = normalizeName('Арматура А500С ф12');
    applySynonyms(n.queryKey);
    assert.match(n.matchKey, /armatura/);
  });

  it('has a test above for every entry', () => {
    // Guard: an entry added without a case here fails this count.
    assert.equal(SYNONYMS.length, 8);
  });
});
