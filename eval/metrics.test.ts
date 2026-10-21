import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bySet, bySource, setOf, summarize, type Outcome } from './metrics.js';

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

describe('bySet', () => {
  it('splits outcomes by the case file in their id', () => {
    assert.equal(setOf('real-metal.csv:12'), 'real-metal');
    assert.equal(setOf('golden.csv:2'), 'golden');
    const sets = bySet([
      outcome({ id: 'golden.csv:2', rank: 1 }),
      outcome({ id: 'real-metal.csv:2', rank: 1 }),
      outcome({ id: 'real-metal.csv:3', rank: null }),
    ]);
    assert.deepEqual(Object.keys(sets).sort(), ['golden', 'real-metal']);
    assert.equal(sets['real-metal']?.n, 2);
    assert.equal(sets['real-metal']?.top1Pct, 50);
    assert.equal(sets['golden']?.top1Pct, 100);
  });
});
