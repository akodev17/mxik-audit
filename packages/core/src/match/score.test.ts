import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BANDS, LLM_WEIGHT, NO_RERANK_CEILING, bandOf, blendWithLlm,
  calibrate, calibratePool, cosineToUnit, marginFactor, retrievalScore, SEMANTIC_COSINE, vectorToUnit,
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

  it('keeps the largest rule stack below the high band without a reranker verdict', () => {
    // identifyingMarked + identifyingPreferred + recommendedUnitMatch on perfect retrieval, the most a code can collect.
    const c = calibrate({ signals: { lexical: 1, vector: 1, rrf: 1, positionRrf: 1 }, rerankAvailable: false, adjustment: 0.03 + 0.08 + 0.03 });
    assert.equal(c, NO_RERANK_CEILING);
    assert.ok(c < BANDS.high);
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

describe('calibratePool', () => {
  const close = [
    { signals: { lexical: 0.8, rrf: 1, llm: 0.9 }, rerankAvailable: true, adjustment: 0.05 },
    { signals: { lexical: 0.79, rrf: 0.98, llm: 0.88 }, rerankAvailable: true, adjustment: 0.05 },
  ];

  it('keeps the leader ahead in a close race and gives the runner-up no free bonus', () => {
    // Regression: the runner-up used to be shaped as if it had no rival (margin 1)
    // while the leader was penalised for the photo finish, so #2 overtook #1 and
    // landed in the bulk-accept band.
    const [leader, runnerUp] = calibratePool(close);
    assert.ok(leader && runnerUp);
    assert.ok(leader.adjusted > runnerUp.adjusted);
    assert.ok(leader.confidence >= runnerUp.confidence, `${leader.confidence} < ${runnerUp.confidence}`);
    assert.equal(runnerUp.confidence, calibrate({ ...close[1]!, margin: 0 }));
    assert.ok(runnerUp.confidence < BANDS.high, `runner-up reached ${runnerUp.confidence}`);
  });

  it('ranks by adjusted score, so a rule can decide who leads', () => {
    const [plain, preferred] = calibratePool([
      { signals: { lexical: 0.8 }, rerankAvailable: true, adjustment: -0.1 },
      { signals: { lexical: 0.78 }, rerankAvailable: true, adjustment: 0.05 },
    ]);
    assert.ok(plain && preferred);
    assert.ok(preferred.adjusted > plain.adjusted);
    assert.equal(plain.confidence, calibrate({ signals: { lexical: 0.8 }, rerankAvailable: true, adjustment: -0.1, margin: 0 }));
  });

  it('gives a lone candidate the full margin, as before', () => {
    const [only] = calibratePool([{ signals: { lexical: 0.8 }, rerankAvailable: true }]);
    assert.equal(only?.confidence, calibrate({ signals: { lexical: 0.8 }, rerankAvailable: true }));
  });

  it('rewards a decisive leader more than a contested one', () => {
    const decisive = calibratePool([close[0]!, { signals: { lexical: 0.1 }, rerankAvailable: true }])[0];
    const contested = calibratePool(close)[0];
    assert.ok((decisive?.confidence ?? 0) > (contested?.confidence ?? 0));
  });

  it('keeps the no-reranker ceiling for every candidate', () => {
    const scores = calibratePool([
      { signals: { lexical: 1, rrf: 1 }, rerankAvailable: false, adjustment: 0.05 },
      { signals: { lexical: 0.2 }, rerankAvailable: false },
    ]);
    for (const s of scores) assert.ok(s.confidence <= NO_RERANK_CEILING);
  });

  it('returns nothing for an empty pool', () => {
    assert.deepEqual(calibratePool([]), []);
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

describe('vectorToUnit', () => {
  it('maps the e5 cosine band linearly onto 0..1 and clamps outside it', () => {
    assert.equal(vectorToUnit(SEMANTIC_COSINE.floor), 0);
    assert.equal(vectorToUnit(SEMANTIC_COSINE.ceil), 1);
    assert.equal(vectorToUnit(0.5), 0);
    assert.equal(vectorToUnit(0.99), 1);
    assert.ok(Math.abs(vectorToUnit(0.875, { floor: 0.8, ceil: 0.95 }) - 0.5) < 1e-9);
  });

  it('separates what the old mapping bunched together', () => {
    // 0.86 vs 0.90: 0.93 vs 0.95 before, 0.40 vs 0.67 on the band.
    assert.ok(cosineToUnit(0.9) - cosineToUnit(0.86) < 0.03);
    assert.ok(vectorToUnit(0.9) - vectorToUnit(0.86) > 0.25);
  });

  it('treats a degenerate band as a step instead of dividing by zero', () => {
    assert.equal(vectorToUnit(0.9, { floor: 0.9, ceil: 0.9 }), 1);
    assert.equal(vectorToUnit(0.89, { floor: 0.9, ceil: 0.9 }), 0);
  });
});
