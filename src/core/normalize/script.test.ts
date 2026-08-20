import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TURNED_COMMA } from './apostrophe.js';
import { cyrillicToLatin, detectScript, latinToCyrillic, scriptAlternates, toLatin } from './script.js';

describe('cyrillicToLatin', () => {
  it('handles the Uzbek-specific letters', () => {
    assert.equal(cyrillicToLatin('ўғқҳ'), `o${TURNED_COMMA}g${TURNED_COMMA}qh`);
  });

  it('transliterates real catalogue names', () => {
    assert.equal(cyrillicToLatin('Тирик отлар'), 'Tirik otlar');
    assert.equal(cyrillicToLatin('Тирик чўчқалар'), `Tirik cho${TURNED_COMMA}chqalar`);
    assert.equal(cyrillicToLatin('Сут'), 'Sut');
    assert.equal(cyrillicToLatin('Шакар'), 'Shakar');
  });

  it('writes ц as ts, the general reading', () => {
    assert.equal(cyrillicToLatin('пастеризацияланган'), 'pasterizatsiyalangan');
  });

  it('applies the ye rule only after a vowel or ь/ъ/й', () => {
    assert.equal(cyrillicToLatin('пьеса'), 'pyesa');
    assert.equal(cyrillicToLatin('маек'), 'mayek');
    // Word-initial and post-consonant stay plain e.
    assert.equal(cyrillicToLatin('експорт'), 'eksport');
    assert.equal(cyrillicToLatin('мебел'), 'mebel');
  });

  it('caps an expansion inside a shouted word but titles it alone', () => {
    assert.equal(cyrillicToLatin('ШАКАР'), 'SHAKAR');
    assert.equal(cyrillicToLatin('Шакар'), 'Shakar');
  });

  it('leaves Latin brand names embedded in Cyrillic untouched', () => {
    // 23% of the catalogue's Latin names are mixed-script like this.
    assert.equal(cyrillicToLatin('Балиқ икраси: Santa Bremor'), 'Baliq ikrasi: Santa Bremor');
  });

  it('drops ь and renders ъ as a modifier apostrophe', () => {
    assert.equal(cyrillicToLatin('коль'), 'kol');
    assert.equal(cyrillicToLatin('таъмир'), 'taʼmir');
  });

  it('passes digits and punctuation through', () => {
    assert.equal(cyrillicToLatin('Сут 1,5 л (2 дона)'), 'Sut 1,5 l (2 dona)');
  });

  it('returns empty for empty input', () => {
    assert.equal(cyrillicToLatin(''), '');
  });
});

describe('latinToCyrillic', () => {
  it('maps digraphs before single letters', () => {
    assert.equal(latinToCyrillic('shakar'), 'шакар');
    assert.equal(latinToCyrillic('chuchqa'), 'чучқа');
    assert.equal(latinToCyrillic(`go${TURNED_COMMA}sht`), 'гўшт');
  });

  it('round-trips a simple name back to the source script', () => {
    assert.equal(latinToCyrillic(cyrillicToLatin('шакар')), 'шакар');
  });
});

describe('detectScript', () => {
  it('classifies the four cases', () => {
    assert.equal(detectScript('Sut'), 'latin');
    assert.equal(detectScript('Сут'), 'cyrillic');
    assert.equal(detectScript('Sut: Родной дом'), 'mixed');
    assert.equal(detectScript('1,5 (500)'), 'neither');
    assert.equal(detectScript(''), 'neither');
  });
});

describe('toLatin', () => {
  it('is idempotent on Latin input', () => {
    const once = toLatin("go'sht");
    assert.equal(toLatin(once), once);
  });

  it('converts mixed-script input', () => {
    assert.equal(toLatin('Сут: PET'), 'Sut: PET');
  });
});

describe('scriptAlternates', () => {
  it('offers both readings of ц', () => {
    assert.ok(scriptAlternates('tsement').includes('sement'));
    assert.ok(scriptAlternates('sement').includes('tsement'));
  });

  it('offers both readings of word-initial e', () => {
    assert.ok(scriptAlternates('yer').includes('er'));
    assert.ok(scriptAlternates('eksport').includes('yeksport'));
  });

  it('only rewrites at word starts, not mid-word', () => {
    // "mebel" must not become "mebyel"; the trailing e must not gain a y.
    assert.ok(!scriptAlternates('mebel').includes('mebyel'));
  });

  it('always includes the input itself', () => {
    for (const s of ['sut', 'tsement', '', 'yer']) {
      assert.ok(scriptAlternates(s).includes(s));
    }
  });
});
