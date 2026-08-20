import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BANDS, LLM_WEIGHT, NO_RERANK_CEILING, bandOf, blendWithLlm,
  calibrate, cosineToUnit, marginFactor, retrievalScore,
} from './score.js';

describe('cosineToUnit', () => {
  it('maps the cosine range onto 0..1', () => {
    assert.equal(cosineToUnit(1), 1);
    assert.equal(cosineToUnit(0), 0.5);
    assert.equal(cosineToUnit(-1), 0);
  });

  it('clamps out-of-range input rather than returning nonsense', () => {
    assert.equal(cosineToUnit(5), 1);
    assert.equal(cosineToUnit(-5), 0);
  });
});

describe('retrievalScore', () => {
  it('is zero when no signal is present', () => {
    assert.equal(retrievalScore({}), 0);
  });

  it('renormalizes over present signals so a missing stage is not a penalty', () => {
    // Lexical alone at 1.0 must score 1.0, not 0.45.
    assert.equal(retrievalScore({ lexical: 1 }), 1);
    assert.equal(retrievalScore({ vector: 1 }), 1);
  });

  it('weights lexical above vector when both are present', () => {
    const lexHigh = retrievalScore({ lexical: 1, vector: 0 });
    const vecHigh = retrievalScore({ lexical: 0, vector: 1 });
    assert.ok(lexHigh > vecHigh, `${lexHigh} should exceed ${vecHigh}`);
  });

  it('clamps individual signals', () => {
    assert.equal(retrievalScore({ lexical: 99 }), 1);
    assert.equal(retrievalScore({ lexical: -99 }), 0);
  });

  it('ignores the llm signal, which is blended separately', () => {
    assert.equal(retrievalScore({ llm: 1 }), 0);
  });
});

describe('blendWithLlm', () => {
  it('returns the retrieval score untouched when there is no verdict', () => {
    assert.equal(blendWithLlm(0.7, undefined), 0.7);
  });

  it('moves the score by exactly the documented weight', () => {
    assert.equal(blendWithLlm(0, 1), LLM_WEIGHT);
    assert.equal(blendWithLlm(1, 0), 1 - LLM_WEIGHT);
  });

  it('cannot be driven above 1 by an over-confident model', () => {
    assert.ok(blendWithLlm(1, 5) <= 1);
  });
});

describe('marginFactor', () => {
  it('is 1 when there is no runner-up', () => {
    assert.equal(marginFactor(0.8, undefined), 1);
  });

  it('is 0 for a dead heat', () => {
    assert.equal(marginFactor(0.8, 0.8), 0);
  });

  it('grows as the gap widens', () => {
    assert.ok(marginFactor(0.8, 0.2) > marginFactor(0.8, 0.6));
  });

  it('does not divide by zero at a zero top score', () => {
    assert.equal(marginFactor(0, 0), 0);
  });

  it('clamps when the runner-up somehow scores higher', () => {
    assert.equal(marginFactor(0.5, 0.9), 0);
  });
});

describe('calibrate', () => {
  it('caps at the no-rerank ceiling when the reranker did not run', () => {
    const c = calibrate({ signals: { lexical: 1, vector: 1, rrf: 1 }, rerankAvailable: false });
    assert.equal(c, NO_RERANK_CEILING);
    assert.ok(c < BANDS.high, 'nothing should reach the high band without a reranker');
  });

  it('can reach the high band once the reranker has spoken', () => {
    const c = calibrate({ signals: { lexical: 1, vector: 1, rrf: 1, llm: 1 }, rerankAvailable: true });
    assert.ok(c >= BANDS.high, `got ${c}`);
  });

  it('never leaves 0..1 however extreme the adjustment', () => {
    assert.equal(calibrate({ signals: { lexical: 1, llm: 1 }, rerankAvailable: true, adjustment: 10 }), 1);
    assert.equal(calibrate({ signals: { lexical: 1, llm: 1 }, rerankAvailable: true, adjustment: -10 }), 0);
  });

  it('applies rule adjustments in the stated direction', () => {
    const base = { signals: { lexical: 0.6, rrf: 0.5 }, rerankAvailable: true };
    assert.ok(calibrate({ ...base, adjustment: 0.05 }) > calibrate(base));
    assert.ok(calibrate({ ...base, adjustment: -0.15 }) < calibrate(base));
  });

  it('gives a decisive winner more than a photo finish', () => {
    const signals = { lexical: 0.8, rrf: 0.8 };
    const decisive = calibrate({ signals, runnerUp: 0.1, rerankAvailable: true });
    const contested = calibrate({ signals, runnerUp: 0.79, rerankAvailable: true });
    assert.ok(decisive > contested, `${decisive} should exceed ${contested}`);
  });

  it('returns 0 for no signal at all', () => {
    assert.equal(calibrate({ signals: {}, rerankAvailable: true }), 0);
  });
});

describe('bandOf', () => {
  it('splits exactly at the documented thresholds', () => {
    assert.equal(bandOf(BANDS.high), 'high');
    assert.equal(bandOf(BANDS.high - 0.0001), 'medium');
    assert.equal(bandOf(BANDS.medium), 'medium');
    assert.equal(bandOf(BANDS.medium - 0.0001), 'low');
  });

  it('handles the extremes', () => {
    assert.equal(bandOf(1), 'high');
    assert.equal(bandOf(0), 'low');
  });
});
