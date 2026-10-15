import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bySource, summarize, type Outcome } from './metrics.js';

function outcome(over: Partial<Outcome>): Outcome {
  return {
    id: 'x', source: 'real', name: 'n', correct: ['01901001003000000'], predicted: null,
    confidence: 0.5, band: 'medium', rank: null, inPool: false, decidedBy: 'fusion', sentToLlm: false, ms: 1,
    ...over,
  };
}

describe('summarize', () => {
  it('computes top-1, top-5 and high-band precision and coverage', () => {
    const m = summarize([
      outcome({ rank: 1, band: 'high', confidence: 0.95, inPool: true }),
      outcome({ rank: 3, band: 'medium', inPool: true, sentToLlm: true }),
      outcome({ rank: null, band: 'high', confidence: 0.92 }),
      outcome({ rank: null, band: 'low' }),
    ]);
    assert.equal(m.top1Pct, 25);
    assert.equal(m.top5Pct, 50);
    assert.equal(m.highCoveragePct, 50);
    assert.equal(m.highPrecisionPct, 50);
    assert.equal(m.ceilingPct, 50);
    assert.equal(m.llmSharePct, 25);
  });

  it('reports high-band precision as null when the band is empty', () => {
    assert.equal(summarize([outcome({})]).highPrecisionPct, null);
    assert.equal(summarize([]).top1Pct, 0);
  });

  it('keeps real and synthetic apart', () => {
    const r = bySource([outcome({ rank: 1 }), outcome({ source: 'synthetic' })]);
    assert.equal(r.real.top1Pct, 100);
    assert.equal(r.synthetic.top1Pct, 0);
    assert.equal(r.all.n, 2);
  });
});
