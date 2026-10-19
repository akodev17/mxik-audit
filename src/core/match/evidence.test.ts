import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evidenceFor, readEvidence, vetoEvidence } from './evidence.js';

const CANDIDATE = { nameUz: 'Guruch', nameRu: 'Рис', unitBinding: 'none' as const, unitCanonical: [] };

describe('evidenceFor', () => {
  it('records the rules that fired, and omits the field when none did', () => {
    const withRules = evidenceFor({ stage: 'fusion', productName: 'guruch', rowUnit: null, candidate: CANDIDATE, rules: ['baseCodePreferred'] });
    assert.deepEqual(withRules.rules, ['baseCodePreferred']);
    const without = evidenceFor({ stage: 'fusion', productName: 'guruch', rowUnit: null, candidate: CANDIDATE, rules: [] });
    assert.equal('rules' in without, false);
  });
});

describe('vetoEvidence', () => {
  it('is a rerank-stage fact with nothing matched', () => {
    const e = vetoEvidence();
    assert.equal(e.stage, 'rerank');
    assert.equal(e.rerankNone, true);
    assert.equal(e.rerankReason, null);
    assert.deepEqual(e.matchedWords, []);
  });
});

describe('readEvidence', () => {
  it('round-trips every field the pipeline stores', () => {
    const stored = {
      ...evidenceFor({ stage: 'barcode', productName: 'guruch', rowUnit: null, candidate: CANDIDATE, rules: ['identifyingMarked'] }),
      dictionaryUses: 4, dictionaryConfirmations: 2, dictionaryConflict: '01901001003000000',
    };
    assert.deepEqual(readEvidence(JSON.parse(JSON.stringify(stored))), stored);
  });

  it('reads the veto back, so the UI branch for it is reachable', () => {
    assert.equal(readEvidence(vetoEvidence())?.rerankNone, true);
  });

  it('drops unknown rule keys and malformed counts instead of trusting them', () => {
    const e = readEvidence({
      stage: 'fusion', unit: 'none', rules: ['baseCodePreferred', 'madeUp', 3],
      dictionaryConfirmations: -1, dictionaryUses: 1.5, dictionaryConflict: 'abc',
    });
    assert.deepEqual(e?.rules, ['baseCodePreferred']);
    assert.equal(e?.dictionaryConfirmations, undefined);
    assert.equal(e?.dictionaryUses, undefined);
    assert.equal(e?.dictionaryConflict, undefined);
  });

  it('keeps reading evidence stored before these fields existed', () => {
    const legacy = { stage: 'dictionary', barcode: false, exactName: false, matchedWords: ['guruch'], unit: 'none', rerankReason: null, rerankNone: false, dictionaryUses: 3 };
    const e = readEvidence(legacy);
    assert.equal(e?.dictionaryUses, 3);
    assert.equal(e?.dictionaryConfirmations, undefined);
    assert.equal(e?.rules, undefined);
  });

  it('rejects what is not evidence', () => {
    assert.equal(readEvidence(null), null);
    assert.equal(readEvidence({ stage: 'guess', unit: 'none' }), null);
  });
});
