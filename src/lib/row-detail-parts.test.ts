import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanPrivilegeName, levelPrefixes, rankAlternatives, reasonFacts } from './row-detail-parts.js';

const base = { severity: 'medium', reason: '', wasRetired: false, snapshotId: null, existingMxik: '00401001001099999', unit: 'litr', codeUnits: ['dona'] };

describe('row detail parts', () => {
  it('build check facts from data, not from the stored sentence', () => {
    assert.equal(reasonFacts({ ...base, type: 'NOT_FOUND', wasRetired: true }).retired, true);
    assert.equal(reasonFacts({ ...base, type: 'MISMATCH', wasRetired: true }).retired, false);
    assert.equal(reasonFacts({ ...base, type: 'MISSING', snapshotId: 2 }).afterUpdate, true);
    assert.deepEqual(reasonFacts({ ...base, type: 'UNIT_CONFLICT' }).requiredUnits, ['dona']);
    assert.deepEqual(reasonFacts({ ...base, type: 'MISMATCH' }).requiredUnits, []);
    assert.equal(reasonFacts({ ...base, type: 'PRIVILEGE_CODE' }).privilegeMismatch, true);
    assert.equal(reasonFacts({ ...base, type: 'PRIVILEGE_CODE', severity: 'info' }).privilegeMismatch, false);
  });

  it('tell a purchase in another unit from a code never purchased', () => {
    const other = '00401001001099999 kodi xaridlarda boshqa oʻlchov birligida (“litr” emas). Savdo…';
    assert.equal(reasonFacts({ ...base, type: 'NOT_PURCHASED', reason: other }).purchasedOtherUnit, true);
    assert.equal(reasonFacts({ ...base, type: 'NOT_PURCHASED', reason: '00401001001099999 kodi mijozning xaridlarida yoʻq.' }).purchasedOtherUnit, false);
  });

  it('tidy the legal text of a privilege', () => {
    assert.equal(cleanPrivilegeName('((SK 483-moddasi) 9 q. ...... 2021 yil  tirik…)'), '(SK 483-moddasi) 9 q. … 2021 yil tirik…)');
    assert.equal(cleanPrivilegeName('PQ-1600 19.08.2011 y. 3-band.'), 'PQ-1600 19.08.2011 y. 3-band.');
  });

  it('rank alternatives: same group first, then other groups, far-off ones dropped', () => {
    const best = { code: '00210006001000000', confidence: 0.745 };
    const alts = [
      { code: '00210006001000000', confidence: 0.745 },
      { code: '03824001020002610', confidence: 0.631 },
      { code: '00205001005000000', confidence: 0.602 },
      { code: '00210005001000000', confidence: 0.591 },
      { code: '07326999999010632', confidence: 0.45 },
    ];
    assert.deepEqual(rankAlternatives(best, alts).map((a) => a.code), ['00205001005000000', '00210005001000000', '03824001020002610']);
    assert.deepEqual(rankAlternatives(null, alts.slice(1, 3)).map((a) => a.code), ['03824001020002610', '00205001005000000']);
  });

  it('split a code into its level prefixes', () => {
    assert.deepEqual(levelPrefixes('00401001001099999'), ['004', '00401', '00401001', '00401001001', '00401001001099999']);
  });
});
