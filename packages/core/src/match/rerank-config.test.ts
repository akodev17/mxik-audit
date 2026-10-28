import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { anthropicConfigFromEnv, DEFAULT_GATE, DEFAULT_GEMINI_MODEL, DEFAULT_MODEL, rerankConfigFromEnv } from './rerank-config.js';
import { BatchedReranker } from './rerank-batched.js';
import { rerankGate } from './rerank-gate.js';
import { NoopRerankProvider, rerankFromEnv } from './rerank.js';

const ANTHROPIC = { RERANK_PROVIDER: 'anthropic' };

describe('rerankConfigFromEnv', () => {
  it('is off without a key', () => {
    const c = rerankConfigFromEnv({});
    assert.equal(c.enabled, false);
    assert.equal(c.disabledReason, 'no GEMINI_API_KEY');
    assert.equal(rerankConfigFromEnv(ANTHROPIC).disabledReason, 'no ANTHROPIC_API_KEY');
    assert.ok(rerankFromEnv({}).reranker instanceof NoopRerankProvider);
  });

  it('picks Gemini when its key is set, else Anthropic', () => {
    const both = rerankConfigFromEnv({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'k' });
    assert.equal(both.provider, 'gemini');
    assert.equal(both.apiKey, 'g');
    assert.equal(both.name, 'gemini:' + DEFAULT_GEMINI_MODEL);
    const claude = rerankConfigFromEnv({ ANTHROPIC_API_KEY: 'k' });
    assert.equal(claude.provider, 'anthropic');
    assert.equal(claude.apiKey, 'k');
    assert.equal(claude.name, 'anthropic:' + DEFAULT_MODEL);
  });

  it('lets RERANK_PROVIDER override the key order, without falling back', () => {
    const chosen = rerankConfigFromEnv({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'k', RERANK_PROVIDER: 'Anthropic' });
    assert.equal(chosen.provider, 'anthropic');
    assert.equal(chosen.apiKey, 'k');
    const missing = rerankConfigFromEnv({ ANTHROPIC_API_KEY: 'k', RERANK_PROVIDER: 'gemini' });
    assert.equal(missing.enabled, false);
    assert.equal(missing.disabledReason, 'no GEMINI_API_KEY');
    assert.equal(missing.apiKey, null);
  });

  it('can be switched off by RERANK_PROVIDER=off, and refuses an unknown provider', () => {
    const off = rerankConfigFromEnv({ GEMINI_API_KEY: 'g', RERANK_PROVIDER: 'off' });
    assert.equal(off.enabled, false);
    assert.equal(off.disabledReason, 'RERANK_PROVIDER=off');
    assert.ok(rerankFromEnv({ GEMINI_API_KEY: 'g', RERANK_PROVIDER: 'off' }).reranker instanceof NoopRerankProvider);
    assert.equal(rerankConfigFromEnv({ GEMINI_API_KEY: 'g', RERANK_PROVIDER: 'openai' }).enabled, false);
  });

  it('builds the Gemini reranker and names it provider:model', () => {
    const { reranker } = rerankFromEnv({ GEMINI_API_KEY: 'g', GEMINI_MODEL: 'gemini-2.5-pro' });
    assert.ok(reranker instanceof BatchedReranker);
    assert.equal(reranker.name, 'gemini:gemini-2.5-pro');
    assert.equal(rerankFromEnv({ ANTHROPIC_API_KEY: 'k' }).reranker.name, 'anthropic:' + DEFAULT_MODEL);
  });

  it('reads the Gemini endpoint only from MXIK_GEMINI_BASE_URL', () => {
    assert.equal(rerankConfigFromEnv({ GEMINI_API_KEY: 'g' }).baseUrl, 'https://generativelanguage.googleapis.com');
    assert.equal(rerankConfigFromEnv({ GEMINI_API_KEY: 'g', MXIK_GEMINI_BASE_URL: 'http://127.0.0.1:9/' }).baseUrl, 'http://127.0.0.1:9');
    assert.equal(rerankConfigFromEnv({ GEMINI_API_KEY: 'g', MXIK_GEMINI_BASE_URL: 'file:///x' }).baseUrl, 'https://generativelanguage.googleapis.com');
  });

  it('keeps Anthropic-only settings off Gemini and reads the thinking budget', () => {
    const g = rerankConfigFromEnv({ GEMINI_API_KEY: 'g' });
    assert.equal(g.effort, null);
    assert.equal(g.fallbacks, false);
    assert.equal(g.thinkingBudget, null);
    assert.equal(rerankConfigFromEnv({ GEMINI_API_KEY: 'g', GEMINI_THINKING_BUDGET: '0' }).thinkingBudget, 0);
    assert.equal(rerankConfigFromEnv({ ANTHROPIC_API_KEY: 'k', GEMINI_THINKING_BUDGET: '0' }).thinkingBudget, null);
  });

  it('gives Claude-only callers the Anthropic settings whatever RERANK_PROVIDER says', () => {
    const c = anthropicConfigFromEnv({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'k', RERANK_PROVIDER: 'gemini' });
    assert.equal(c.provider, 'anthropic');
    assert.equal(c.apiKey, 'k');
    assert.equal(anthropicConfigFromEnv({ GEMINI_API_KEY: 'g' }).enabled, false);
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
    assert.equal(rerankConfigFromEnv(ANTHROPIC).effort, 'low');
    assert.equal(rerankConfigFromEnv({ ...ANTHROPIC, ANTHROPIC_EFFORT: '' }).effort, null);
  });

  it('reads and clamps the gate', () => {
    assert.deepEqual(rerankConfigFromEnv({}).gate, DEFAULT_GATE);
    const c = rerankConfigFromEnv({ RERANK_GATE_CONFIDENCE: '1.01', RERANK_GATE_MARGIN: 'junk' });
    assert.equal(c.gate.minConfidence, 1.01);
    assert.equal(c.gate.minMargin, DEFAULT_GATE.minMargin);
  });

  it('knows prices for current models and accepts an override', () => {
    assert.deepEqual(rerankConfigFromEnv(ANTHROPIC).price, { inputPerMTok: 4, outputPerMTok: 20 });
    assert.equal(rerankConfigFromEnv({ ...ANTHROPIC, ANTHROPIC_MODEL: 'claude-unknown' }).price, null);
    assert.deepEqual(rerankConfigFromEnv({}).price, { inputPerMTok: 0.3, outputPerMTok: 2.5 });
    assert.deepEqual(rerankConfigFromEnv({ GEMINI_MODEL: 'gemini-2.5-pro' }).price, { inputPerMTok: 1.25, outputPerMTok: 10 });
    assert.equal(rerankConfigFromEnv({ GEMINI_MODEL: 'gemini-unknown' }).price, null);
    assert.deepEqual(
      rerankConfigFromEnv({ GEMINI_PRICE_INPUT_PER_MTOK: '0.5', GEMINI_PRICE_OUTPUT_PER_MTOK: '3', RERANK_PRICE_INPUT_PER_MTOK: '9', RERANK_PRICE_OUTPUT_PER_MTOK: '9' }).price,
      { inputPerMTok: 0.5, outputPerMTok: 3 },
    );
    assert.deepEqual(
      rerankConfigFromEnv({ ...ANTHROPIC, GEMINI_PRICE_INPUT_PER_MTOK: '0.5', GEMINI_PRICE_OUTPUT_PER_MTOK: '3' }).price,
      { inputPerMTok: 4, outputPerMTok: 20 },
    );
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
