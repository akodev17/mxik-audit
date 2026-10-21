import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { leafSearchText, weightedSearchText, weightedVectorSql, type CodeNames } from './search-document.js';

const EMPTY: CodeNames = {
  nameUz: null, nameRu: null,
  subPositionNameUz: null, subPositionNameRu: null, subPositionNameUzCyrl: null,
  positionNameUz: null, positionNameRu: null, positionNameUzCyrl: null,
  classNameUz: null, classNameRu: null, classNameUzCyrl: null,
  groupNameUz: null, groupNameRu: null, groupNameUzCyrl: null,
  brandNameUz: null, brandNameRu: null, brandNameUzCyrl: null,
  attributeNameUz: null, attributeNameRu: null, attributeNameUzCyrl: null,
};

describe('weightedSearchText', () => {
  const sheet: CodeNames = {
    ...EMPTY,
    nameUz: 'Temir yassi prokat', nameRu: 'Плоский прокат из железа, лист горячекатаный',
    subPositionNameRu: 'Плоский прокат из железа',
    positionNameRu: 'Горячекатаные прокат плоский из железа или нелегированной стали',
    classNameRu: 'Прокат плоский', groupNameRu: 'Черные металлы',
    brandNameRu: 'ММК',
  };

  it('keeps the leaf names exactly as the trigram text has them', () => {
    const t = weightedSearchText(sheet);
    assert.equal(t.a, leafSearchText(sheet.nameUz, sheet.nameRu));
    assert.equal(t.a, 'temir yassi prokat ploskiy prokat iz jeleza list goryachekataniy');
  });

  it('indexes each hierarchy word once, at its most specific level', () => {
    const t = weightedSearchText(sheet);
    // "ploskiy", "prokat", "jeleza" are already leaf words; the position adds the rest.
    assert.equal(t.b, 'goryachekataniye ili nelegirovannoy stali');
    assert.equal(t.c, 'cherniye metalli');
    assert.equal(t.d, 'mmk');
  });

  it('reads all three languages and skips missing names', () => {
    const t = weightedSearchText({ ...EMPTY, nameUz: 'Gisht', groupNameUz: 'Qurilish', groupNameUzCyrl: 'Қурилиш', groupNameRu: 'Строительство' });
    assert.equal(t.b, '');
    assert.equal(t.c, 'qurilish stroitelstvo');
  });
});

describe('weightedVectorSql', () => {
  it('builds one weighted tsvector from four inputs, A to D', () => {
    const sql = weightedVectorSql('$1', '$2', '$3', '$4');
    assert.match(sql, /setweight\(to_tsvector\('simple', coalesce\(\$1, ''\)\), 'A'\)/);
    assert.match(sql, /\$4, ''\)\), 'D'\)$/);
  });
});
