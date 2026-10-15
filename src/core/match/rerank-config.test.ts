import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_GATE, DEFAULT_MODEL, rerankConfigFromEnv } from './rerank-config.js';
import { rerankGate } from './rerank-gate.js';
import { NoopRerankProvider, rerankFromEnv } from './rerank.js';

describe('rerankConfigFromEnv', () => {
  it('is off without a key', () => {
    const c = rerankConfigFromEnv({});
    assert.equal(c.enabled, false);
    assert.equal(c.disabledReason, 'no ANTHROPIC_API_KEY');
  });

  it('can be switched off even with a key', () => {
    const c = rerankConfigFromEnv({ ANTHROPIC_API_KEY: 'k', MXIK_LLM_ENABLED: 'false' });
    assert.equal(c.enabled, false);
    assert.ok(rerankFromEnv({ ANTHROPIC_API_KEY: 'k', MXIK_LLM_ENABLED: 'false' }).reranker instanceof NoopRerankProvider);
  });

  it('takes the model from ANTHROPIC_MODEL and defaults to the documented one', () => {
    assert.equal(rerankConfigFromEnv({ ANTHROPIC_API_KEY: 'k' }).model, DEFAULT_MODEL);
    assert.equal(rerankConfigFromEnv({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-haiku-5-5' }).model, 'claude-haiku-5-5');
  });

  it('never inherits ANTHROPIC_BASE_URL', () => {
    const c = rerankConfigFromEnv({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'https://proxy.example' });
    assert.equal(c.baseUrl, 'https://api.anthropic.com');
    const o = rerankConfigFromEnv({ ANTHROPIC_API_KEY: 'k', MXIK_ANTHROPIC_BASE_URL: 'https://chosen.example' });
    assert.equal(o.baseUrl, 'https://chosen.example');
  });

  it('only asks for server-side fallbacks on models that support them', () => {
    assert.equal(rerankConfigFromEnv({ ANTHROPIC_API_KEY: 'k' }).fallbacks, true);
    assert.equal(rerankConfigFromEnv({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-haiku-5-5' }).fallbacks, false);
    assert.equal(rerankConfigFromEnv({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_FALLBACKS: 'off' }).fallbacks, false);
  });

  it('defaults effort to low and omits it when set empty', () => {
    assert.equal(rerankConfigFromEnv({}).effort, 'low');
    assert.equal(rerankConfigFromEnv({ ANTHROPIC_EFFORT: '' }).effort, null);
  });

  it('reads and clamps the gate', () => {
    assert.deepEqual(rerankConfigFromEnv({}).gate, DEFAULT_GATE);
    const c = rerankConfigFromEnv({ RERANK_GATE_CONFIDENCE: '1.01', RERANK_GATE_MARGIN: 'junk' });
    assert.equal(c.gate.minConfidence, 1.01);
    assert.equal(c.gate.minMargin, DEFAULT_GATE.minMargin);
  });

  it('knows prices for current models and accepts an override', () => {
    assert.deepEqual(rerankConfigFromEnv({}).price, { inputPerMTok: 4, outputPerMTok: 20 });
    assert.equal(rerankConfigFromEnv({ ANTHROPIC_MODEL: 'claude-unknown' }).price, null);
    assert.deepEqual(
      rerankConfigFromEnv({ RERANK_PRICE_INPUT_PER_MTOK: '1', RERANK_PRICE_OUTPUT_PER_MTOK: '2' }).price,
      { inputPerMTok: 1, outputPerMTok: 2 },
    );
  });
});

describe('rerankGate', () => {
  const gate = { minConfidence: 0.9, minMargin: 0.1 };

  it('sends a low-confidence row', () => {
    assert.equal(rerankGate([0.7, 0.3], gate).rerank, true);
  });

  it('sends a confident row whose runner-up is too close', () => {
    assert.equal(rerankGate([0.95, 0.9], gate).rerank, true);
  });

  it('skips a confident row with a clear margin', () => {
    assert.equal(rerankGate([0.3, 0.97], gate).rerank, false);
  });

  it('sends everything when no gate is configured', () => {
    assert.equal(rerankGate([0.99, 0.1], undefined).rerank, true);
  });

  it('sends nothing for an empty pool', () => {
    assert.equal(rerankGate([], gate).rerank, false);
  });
});
