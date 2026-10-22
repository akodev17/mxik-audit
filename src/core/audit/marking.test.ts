import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MatchEvidence } from '../match/evidence.js';
import type { MatchStage, MxikCandidate, ScoredCandidate } from '../match/types.js';
import type { Finding } from './checks.js';
import { markingRequired } from './marking.js';

const JUICE = '02202001001000000';

function evidence(stage: MatchStage): MatchEvidence {
  return { stage, barcode: stage === 'barcode', exactName: false, matchedWords: [], unit: 'none', rerankReason: null, rerankNone: false };
}

function suggestion(code: string, isMarked: boolean): ScoredCandidate {
  const candidate: MxikCandidate = {
    code, nameUz: 'Sharbat', nameRu: 'Сок',
    groupName: 'ICHIMLIKLAR', className: null, positionName: null, subPositionName: null,
    brandName: null, attributeName: null,
    subPositionCode: code.slice(0, 11), isBase: false, isMarked,
    unitBinding: 'none', unitCanonical: [], unitRaw: null, unitContainer: null, barcode: null,
  };
  return {
    candidate, signals: {}, ranks: {}, confidence: 0.5, band: 'low',
    reason: 'because', stage: 'fusion', adjustments: [], evidence: evidence('fusion'),
  };
}

function notFound(confidence: number | null, stage: MatchStage = 'fusion'): Finding {
  return {
    type: 'NOT_FOUND', severity: 'high', suggestedMxik: JUICE, confidence,
    alternatives: [], reason: 'not in the classifier', wasRetired: false, evidence: evidence(stage),
  };
}

describe('markingRequired', () => {
  const marked = [suggestion(JUICE, true)];

  it('ignores a marked suggestion with a low match', () => {
    // Row "123": junk code, best name match is juice at "Past moslik".
    assert.equal(markingRequired(false, [notFound(0.42)], marked), false);
  });

  it('ignores a marked suggestion with a middling match', () => {
    assert.equal(markingRequired(false, [notFound(0.8)], marked), false);
  });

  it('counts a marked suggestion with a high match', () => {
    assert.equal(markingRequired(false, [notFound(0.9)], marked), true);
  });

  it('counts a marked suggestion from a barcode or the dictionary, whatever its score', () => {
    assert.equal(markingRequired(false, [notFound(0.3, 'barcode')], marked), true);
    assert.equal(markingRequired(false, [notFound(null, 'dictionary')], marked), true);
  });

  it('ignores a high match whose code is not marked', () => {
    assert.equal(markingRequired(false, [notFound(0.95)], [suggestion(JUICE, false)]), false);
  });

  it('counts the row’s own marked code even with no trustworthy suggestion', () => {
    assert.equal(markingRequired(true, [notFound(0.42)], marked), true);
    assert.equal(markingRequired(true, [], []), true);
  });
});
