import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONFIDENCE_LABELS, confidenceLabel, findingLabelKey, labelKey } from './confidence-labels.js';
import { evidenceFor, vetoEvidence } from './evidence.js';

const CANDIDATE = { nameUz: 'Guruch', nameRu: 'Рис', unitBinding: 'none' as const, unitCanonical: [] };
const evidence = (stage: 'barcode' | 'dictionary' | 'fusion' | 'rerank') => evidenceFor({ stage, productName: 'guruch', rowUnit: null, candidate: CANDIDATE });

describe('confidenceLabel', () => {
  it('splits the score into bands at the documented thresholds', () => {
    assert.equal(confidenceLabel(CONFIDENCE_LABELS.sure), 'sure');
    assert.equal(confidenceLabel(CONFIDENCE_LABELS.sure - 0.001), 'likely');
    assert.equal(confidenceLabel(CONFIDENCE_LABELS.likely), 'likely');
    assert.equal(confidenceLabel(CONFIDENCE_LABELS.likely - 0.001), 'check');
  });

  it('keeps the barcode override for existing callers', () => {
    assert.equal(confidenceLabel(0.1, { barcode: true }), 'sure');
  });
});

describe('labelKey', () => {
  it('names the source for identities instead of a score band', () => {
    assert.equal(labelKey(1, 'barcode'), 'barcode');
    assert.equal(labelKey(0.96, 'dictionary'), 'dictionary');
  });

  it('falls back to the score band for everything else', () => {
    assert.equal(labelKey(0.95, 'exact'), 'sure');
    assert.equal(labelKey(0.8, 'rerank'), 'likely');
    assert.equal(labelKey(0.4, 'fusion'), 'check');
    assert.equal(labelKey(0.4), 'check');
  });

  it('has nothing to say without a score or an identity', () => {
    assert.equal(labelKey(null, 'fusion'), null);
    assert.equal(labelKey(null), null);
  });
});

describe('findingLabelKey', () => {
  it('reads the stage from stored evidence', () => {
    assert.equal(findingLabelKey({ confidence: 1, evidence: evidence('barcode') }), 'barcode');
    assert.equal(findingLabelKey({ confidence: 0.96, evidence: evidence('dictionary') }), 'dictionary');
    assert.equal(findingLabelKey({ confidence: 0.7, evidence: evidence('fusion') }), 'check');
  });

  it('handles findings without evidence or score', () => {
    assert.equal(findingLabelKey({ confidence: 0.92, evidence: null }), 'sure');
    assert.equal(findingLabelKey({ confidence: null, evidence: vetoEvidence() }), null);
  });
});
