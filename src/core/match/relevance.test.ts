import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isUnrelated, sharesMeaning, UNRELATED_BELOW } from './relevance.js';
import type { MxikCandidate } from './types.js';

function candidate(overrides: Partial<MxikCandidate> = {}): MxikCandidate {
  return {
    code: '07304001001000000',
    nameUz: 'Choksiz poʻlat quvurlar',
    nameRu: 'Трубы стальные бесшовные',
    groupName: 'Qora metallardan buyumlar',
    className: 'Quvurlar',
    positionName: null,
    subPositionName: null,
    brandName: null,
    attributeName: null,
    subPositionCode: '07304001001',
    isBase: true,
    isMarked: false,
    unitBinding: 'none',
    unitCanonical: [],
    unitRaw: null,
    unitContainer: null,
    barcode: null,
    ...overrides,
  };
}

const cement = candidate({
  code: '02523002001000000', nameUz: 'Portlandsement SEM II/B-Sh', nameRu: 'Портландцемент ЦЕМ II/B-Ш',
  groupName: 'Mineral mahsulotlar', className: 'Sement',
});

describe('sharesMeaning', () => {
  it('counts an abbreviation through its expansion: "б/ш" shares meaning with "бесшовные"', () => {
    // Nothing but the expansion connects them: no "труб" stem in the code.
    const seamless = candidate({ nameUz: 'Choksiz buyumlar', nameRu: 'Изделия бесшовные', groupName: null, className: null });
    assert.equal(sharesMeaning('Труба б/ш 32х3,0', seamless), true);
    assert.equal(isUnrelated('Труба б/ш 32х3,0', seamless, 0.4), false);
  });

  it('does not count two-letter fragments as shared meaning, on either side', () => {
    // Only "sh" (from the code's "B-Sh") and "ii" could connect them; neither is a word.
    assert.equal(sharesMeaning('Профиль ПН ii sh 50', cement), false);
    assert.equal(isUnrelated('Профиль ПН ii sh 50', cement, UNRELATED_BELOW - 0.01), true);
  });

  it('still relates a name made only of short words, rather than hiding everything', () => {
    assert.equal(sharesMeaning('ПН 50', cement), true);
  });

  it('never hides a candidate retrieval or the reranker vouched for', () => {
    assert.equal(isUnrelated('Профиль ПН ii sh 50', cement, UNRELATED_BELOW), false);
  });

  it('counts the classifier words a synonym searched for', () => {
    const wool = candidate({ nameUz: 'Mineral tola', nameRu: 'Минеральная вата', groupName: null, className: null });
    assert.equal(sharesMeaning('Минвата Rockwool 50мм', wool), false);
    assert.equal(sharesMeaning('Минвата Rockwool 50мм', wool, ['mineralnaya', 'vata']), true);
    assert.equal(isUnrelated('Минвата Rockwool 50мм', wool, 0.5, ['mineralnaya', 'vata']), false);
  });

  it('matches words up to a suffix, in the hierarchy as well as the names', () => {
    assert.equal(sharesMeaning('Quvur 20 mm', candidate()), true);
    assert.equal(sharesMeaning('Metall buyum', candidate()), true);
  });
});
