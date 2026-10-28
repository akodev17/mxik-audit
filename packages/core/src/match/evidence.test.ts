import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evidenceFor, matchedWords, readEvidence, vetoEvidence, withTnved } from './evidence.js';

const CANDIDATE = { nameUz: 'Guruch', nameRu: 'Рис', unitBinding: 'none' as const, unitCanonical: [] };

describe('evidenceFor', () => {
  it('records the rules that fired, and omits the field when none did', () => {
    const withRules = evidenceFor({ stage: 'fusion', productName: 'guruch', rowUnit: null, candidate: CANDIDATE, rules: ['baseCodePreferred'] });
    assert.deepEqual(withRules.rules, ['baseCodePreferred']);
    const without = evidenceFor({ stage: 'fusion', productName: 'guruch', rowUnit: null, candidate: CANDIDATE, rules: [] });
    assert.equal('rules' in without, false);
  });

  it('names the synonym that fired and counts its classifier words as matched', () => {
    const rebar = { nameUz: 'Armaturali prokat', nameRu: 'Прокат арматурный', unitBinding: 'none' as const, unitCanonical: [] };
    const synonyms = { applied: ['арматура → прокат арматурный'], added: ['prokat', 'armaturniy'] };
    const e = evidenceFor({ stage: 'fusion', productName: 'Арматура 12', rowUnit: null, candidate: rebar, synonyms });
    assert.deepEqual(e.synonymApplied, ['арматура → прокат арматурный']);
    assert.deepEqual(e.matchedWords, ['prokat', 'armaturniy']);
    const plain = evidenceFor({ stage: 'fusion', productName: 'guruch', rowUnit: null, candidate: CANDIDATE, synonyms: { applied: [], added: [] } });
    assert.equal('synonymApplied' in plain, false);
  });

  it('lists the words found only in the hierarchy, without fragments or numbers, once each', () => {
    const e = evidenceFor({ stage: 'fusion', productName: 'Лист г/к 2', rowUnit: null, candidate: CANDIDATE, hierarchyWords: ['goryachekataniy', 'goryachekataniy', 'sh', '2'] });
    assert.deepEqual(e.matchedHierarchyWords, ['goryachekataniy']);
    const none = evidenceFor({ stage: 'fusion', productName: 'guruch', rowUnit: null, candidate: CANDIDATE, hierarchyWords: [] });
    assert.equal('matchedHierarchyWords' in none, false);
  });
});

describe('matchedWords', () => {
  const CEMENT = { nameUz: 'Portlandsement SEM II/B-Sh 32.5 N', nameRu: 'Портландцемент SEM II/B-Sh 32.5 N', unitBinding: 'none' as const, unitCanonical: [] };

  it('never offers a fragment shorter than three letters as a matched word', () => {
    // "б/ш" folds to "b sh"; the cement brand "B-Sh" shares both, and that alone was the evidence.
    assert.deepEqual(matchedWords('Труба ГД б/ш 32х3,0', CEMENT), []);
  });

  it('still lists the real words a product shares with the code', () => {
    assert.deepEqual(matchedWords('Portlandsement M400', CEMENT), ['portlandsement']);
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

describe('withTnved', () => {
  const base = evidenceFor({ stage: 'fusion', productName: 'truba', rowUnit: null, candidate: CANDIDATE });
  const outside = (code: string): boolean => !code.startsWith('07306');

  it('adds the heading, and a flag only where it holds', () => {
    const inside = withTnved(base, '07306001001000000', { heading: '7306', existingOutside: false, fallback: false }, outside);
    assert.deepEqual(inside, { ...base, tnvedHeading: '7306' });
    const all = withTnved(base, '07304001001000000', { heading: '7306', existingOutside: true, fallback: true }, outside);
    assert.deepEqual(all, { ...base, tnvedHeading: '7306', tnvedOutside: true, tnvedExistingOutside: true, tnvedFallback: true });
  });
});

describe('readEvidence', () => {
  it('round-trips every field the pipeline stores', () => {
    const stored = {
      ...evidenceFor({ stage: 'barcode', productName: 'guruch', rowUnit: null, candidate: CANDIDATE, rules: ['identifyingMarked'] }),
      dictionaryUses: 4, dictionaryConfirmations: 2, dictionaryConflict: '01901001003000000',
      synonymApplied: ['минвата → минеральная вата'],
      matchedHierarchyWords: ['goryachekataniy'],
      tnvedHeading: '7306', tnvedOutside: true as const, tnvedExistingOutside: true as const, tnvedFallback: true as const,
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

  it('drops a malformed TN VED heading and anything but true for its flags', () => {
    const e = readEvidence({ stage: 'fusion', unit: 'none', tnvedHeading: '73', tnvedOutside: 'yes', tnvedFallback: 1 });
    assert.equal(e?.tnvedHeading, undefined);
    assert.equal(e?.tnvedOutside, undefined);
    assert.equal(e?.tnvedFallback, undefined);
  });

  it('rejects what is not evidence', () => {
    assert.equal(readEvidence(null), null);
    assert.equal(readEvidence({ stage: 'guess', unit: 'none' }), null);
  });
});
