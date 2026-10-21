import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ABBREVIATIONS, expandAbbreviations } from './abbreviations.js';

const CYRILLIC = /[Ѐ-ӿ]/;

describe('expandAbbreviations', () => {
  for (const entry of ABBREVIATIONS) {
    for (const form of entry.forms) {
      const cyrillic = CYRILLIC.test(form);
      const term = cyrillic ? entry.ru : (entry.uz ?? entry.ru);
      const want = entry.unit ? 'Труба 40' : `Труба ${entry.keep ? `${form} ${term}` : term} 40`;

      it(`${entry.unit ? 'drops' : 'expands'} "${form}" in place`, () => {
        const r = expandAbbreviations(`Труба ${form} 40`);
        assert.equal(r.text, want);
        assert.deepEqual(entry.unit ? r.removed : r.expanded, [form]);
      });

      it(`matches "${form}" in any case and with a trailing dot`, () => {
        const upper = expandAbbreviations(`Труба ${form.toUpperCase()}. 40`);
        const lower = expandAbbreviations(`Труба ${form.toLowerCase()} 40`);
        assert.equal(upper.expanded.length + upper.removed.length, 1);
        assert.equal(lower.expanded.length + lower.removed.length, 1);
        if (!entry.keep) {
          assert.equal(upper.text, want);
          assert.equal(lower.text, want);
        }
      });

      it(`leaves "${form}" alone inside a longer word`, () => {
        const glued = `x${form}y`;
        assert.equal(expandAbbreviations(glued).text, glued);
      });
    }
  }

  it('expands every abbreviation of a real metal price-list row, keeping word order', () => {
    assert.equal(expandAbbreviations('Труба ГД б/ш').text, 'Труба горячедеформированные бесшовные');
    assert.equal(expandAbbreviations('Трубы эл/св').text, 'Трубы электросварные');
    assert.equal(expandAbbreviations('Лист г/к риф.').text, 'Лист горячекатаный рифленый');
    assert.equal(expandAbbreviations('Лист х/к').text, 'Лист холоднокатаный');
  });

  it('gives Latin-script rows the Uzbek term the classifier uses', () => {
    assert.equal(expandAbbreviations('Quvur b/sh').text, 'Quvur choksiz');
    assert.equal(expandAbbreviations('List g/k').text, 'List issiq prokatlangan');
  });

  it('keeps the separator after a dotted abbreviation glued to the next word', () => {
    assert.equal(expandAbbreviations('проф.труба').text, 'профильная.труба');
  });

  it('does not touch ordinary words', () => {
    for (const word of ['шоколад', 'Шоколад молочный', 'Гдз', 'профиль', 'армия', 'Рифма', 'Sut 1 l', 'г.Ташкент']) {
      const r = expandAbbreviations(word);
      assert.equal(r.text, word);
      assert.deepEqual(r.expanded, []);
    }
  });

  it('every entry has a form and a replacement', () => {
    for (const entry of ABBREVIATIONS) {
      assert.ok(entry.forms.length > 0);
      assert.ok(entry.ru.trim().length > 0);
    }
  });
});
