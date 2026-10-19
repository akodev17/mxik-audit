import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { acceptCode, decisionMode, noSuggestion } from './finding-kinds.js';

const CODE = '12345678901234567';
const OWN = '76543210987654321';

describe('finding kinds', () => {
  it('only code-suggesting checks can lack a suggestion', () => {
    for (const type of ['NOT_PURCHASED', 'PRIVILEGE_CODE', 'PRIVILEGE_OPPORTUNITY', 'UNIT_CONFLICT']) {
      assert.equal(noSuggestion({ type, suggestedMxik: null }), false, type);
    }
    assert.equal(noSuggestion({ type: 'MISSING', suggestedMxik: null }), true);
    assert.equal(noSuggestion({ type: 'MISMATCH', suggestedMxik: CODE, rerankNone: true }), true);
    assert.equal(noSuggestion({ type: 'NOT_FOUND', suggestedMxik: CODE }), false);
  });

  it('confirming checks keep the current code; without a live code the reviewer picks one', () => {
    assert.equal(decisionMode({ type: 'NOT_PURCHASED', suggestedMxik: null, currentLive: true }), 'confirm');
    assert.equal(decisionMode({ type: 'PRIVILEGE_CODE', suggestedMxik: null, currentLive: false }), 'pick');
    assert.equal(decisionMode({ type: 'MISSING', suggestedMxik: CODE, currentLive: false }), 'suggest');
    assert.equal(decisionMode({ type: 'MISSING', suggestedMxik: null, currentLive: false }), 'pick');
    assert.equal(decisionMode({ type: 'PRIVILEGE_OPPORTUNITY', suggestedMxik: null, currentLive: true }), 'pick');
  });

  it('records the code an acceptance means for each check', () => {
    assert.equal(acceptCode({ type: 'NOT_PURCHASED', suggestedMxik: null, existingMxik: OWN }), OWN);
    assert.equal(acceptCode({ type: 'UNIT_CONFLICT', suggestedMxik: OWN, existingMxik: OWN }), OWN);
    assert.equal(acceptCode({ type: 'MISMATCH', suggestedMxik: CODE, existingMxik: OWN }), CODE);
    assert.equal(acceptCode({ type: 'MISMATCH', suggestedMxik: CODE, existingMxik: OWN, rerankNone: true }), null);
    assert.equal(acceptCode({ type: 'PRIVILEGE_OPPORTUNITY', suggestedMxik: null, existingMxik: OWN }), null);
  });
});
