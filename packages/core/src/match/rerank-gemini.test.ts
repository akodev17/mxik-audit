import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BatchedReranker } from './rerank-batched.js';
import type { BatchRow } from './rerank-claude.js';
import { rerankConfigFromEnv } from './rerank-config.js';
import { GEMINI_RESPONSE_SCHEMA, GeminiRerankClient, MAX_WAIT_MS, retryDelayMs, toGeminiSchema, type FetchLike } from './rerank-gemini.js';
import { OUTPUT_SCHEMA, SYSTEM_PROMPT } from './rerank-prompt.js';
import { formatLlmUsage } from './rerank-usage.js';
import type { MxikCandidate, RerankRequest } from './types.js';

function candidate(code: string): MxikCandidate {
  return {
    code, nameUz: `name ${code}`, nameRu: `name ${code}`,
    groupName: null, className: null, positionName: null, subPositionName: null,
    brandName: null, attributeName: null, subPositionCode: code.slice(0, 11),
    isBase: code.endsWith('000000'), isMarked: false,
    unitBinding: 'none', unitCanonical: [], unitRaw: null, unitContainer: null, barcode: null,
  };
}

const A = '01901001003000000';
const B = '01901001003002001';
const request = (name: string): RerankRequest => ({ productName: name, normalizedKey: name, unit: 'dona', candidates: [candidate(A), candidate(B)] });
const ROWS: BatchRow[] = [{ id: 'r1', request: request('Guruch') }, { id: 'r2', request: request('Shakar') }];

const CONFIG = rerankConfigFromEnv({ GEMINI_API_KEY: 'test-key', MXIK_GEMINI_BASE_URL: 'http://gemini.test', RERANK_MAX_RETRIES: '3' });

const answer = (rows: unknown, extra: Record<string, unknown> = {}): unknown => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ rows }) }], role: 'model' }, finishReason: 'STOP', ...extra }],
  usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 150, thoughtsTokenCount: 50, totalTokenCount: 1400 },
});
const OK_ROWS = [
  { id: 'r1', none: false, ranking: [{ code: A, confidence: 0.9, reason: 'Guruch.' }] },
  { id: 'r2', none: true, ranking: [] },
];

type Call = { url: string; init: RequestInit };

/** Replies in order; a reply is a Response, or an Error to throw as a network failure. */
function fakeFetch(replies: (Response | Error)[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init });
      const next = replies.shift();
      if (!next) return Promise.reject(new Error('no more replies'));
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function client(replies: (Response | Error)[], config = CONFIG) {
  const fake = fakeFetch(replies);
  const waits: number[] = [];
  const gemini = new GeminiRerankClient(config, {
    fetch: fake.fetch,
    sleep: (ms) => { waits.push(ms); return Promise.resolve(); },
    random: () => 1,
  });
  return { gemini, calls: fake.calls, waits };
}

describe('toGeminiSchema', () => {
  it('converts OUTPUT_SCHEMA to the Gemini dialect', () => {
    assert.deepEqual(GEMINI_RESPONSE_SCHEMA, {
      type: 'OBJECT',
      properties: {
        rows: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING' },
              none: { type: 'BOOLEAN' },
              ranking: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: { code: { type: 'STRING' }, confidence: { type: 'NUMBER' }, reason: { type: 'STRING' } },
                  propertyOrdering: ['code', 'confidence', 'reason'],
                  required: ['code', 'confidence', 'reason'],
                },
              },
            },
            propertyOrdering: ['id', 'none', 'ranking'],
            required: ['id', 'none', 'ranking'],
          },
        },
      },
      propertyOrdering: ['rows'],
      required: ['rows'],
    });
    assert.ok(!JSON.stringify(GEMINI_RESPONSE_SCHEMA).includes('additionalProperties'));
    assert.deepEqual(toGeminiSchema(OUTPUT_SCHEMA), GEMINI_RESPONSE_SCHEMA);
  });

  it('keeps enums and refuses keywords it does not know', () => {
    assert.deepEqual(toGeminiSchema({ type: 'string', enum: ['a', 'b'] }), { type: 'STRING', enum: ['a', 'b'] });
    assert.throws(() => toGeminiSchema({ type: 'string', pattern: '^x' } as never), /pattern/);
  });
});

describe('GeminiRerankClient', () => {
  it('sends the prompt, schema and key the API expects', async () => {
    const { gemini, calls } = client([json(answer(OK_ROWS))]);
    await gemini.rankBatch(ROWS);
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.url, 'http://gemini.test/v1beta/models/gemini-2.5-flash:generateContent');
    assert.equal(call.init.method, 'POST');
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers['x-goog-api-key'], 'test-key');
    assert.ok(!call.url.includes('test-key'), 'the key never goes in the URL');
    assert.ok(call.init.signal instanceof AbortSignal);

    const body = JSON.parse(call.init.body as string) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string; parts: { text: string }[] }[];
      generationConfig: Record<string, unknown>;
    };
    assert.equal(body.systemInstruction.parts[0]?.text, SYSTEM_PROMPT);
    const prompt = body.contents[0]?.parts[0]?.text ?? '';
    assert.match(prompt, /Row r1\n {2}product name: Guruch/);
    assert.match(prompt, /Row r2\n {2}product name: Shakar/);
    assert.equal(body.generationConfig['responseMimeType'], 'application/json');
    assert.deepEqual(body.generationConfig['responseSchema'], GEMINI_RESPONSE_SCHEMA);
    assert.equal(body.generationConfig['temperature'], 0);
    assert.equal(body.generationConfig['thinkingConfig'], undefined);
  });

  it('passes a configured thinking budget', () => {
    const config = rerankConfigFromEnv({ GEMINI_API_KEY: 'k', GEMINI_THINKING_BUDGET: '0' });
    const body = new GeminiRerankClient(config).requestBody(ROWS) as { generationConfig: Record<string, unknown> };
    assert.deepEqual(body.generationConfig['thinkingConfig'], { thinkingBudget: 0 });
    // Gemini 3 takes a level; the API refuses a level and a budget together.
    const leveled = rerankConfigFromEnv({ GEMINI_API_KEY: 'k', GEMINI_THINKING_LEVEL: 'Low', GEMINI_THINKING_BUDGET: '0' });
    const levelBody = new GeminiRerankClient(leveled).requestBody(ROWS) as { generationConfig: Record<string, unknown> };
    assert.deepEqual(levelBody.generationConfig['thinkingConfig'], { thinkingLevel: 'low' });
    assert.equal(rerankConfigFromEnv({ GEMINI_API_KEY: 'k', GEMINI_THINKING_LEVEL: 'extreme' }).thinkingLevel, null);
  });

  it('splits the answer by row and counts thinking as output', async () => {
    const { gemini } = client([json(answer(OK_ROWS))]);
    const reply = await gemini.rankBatch(ROWS);
    assert.equal(reply.failure, null);
    assert.deepEqual(reply.rows.get('r1'), OK_ROWS[0]);
    assert.deepEqual(reply.rows.get('r2'), OK_ROWS[1]);
    assert.equal(reply.inputTokens, 1200);
    assert.equal(reply.outputTokens, 200);
    assert.ok(reply.latencyMs >= 0);
  });

  it('ignores thought parts and ids nobody asked for', async () => {
    const body = {
      candidates: [{
        content: { parts: [{ text: 'thinking about it', thought: true }, { text: JSON.stringify({ rows: [...OK_ROWS, { id: 'r9', none: true, ranking: [] }] }) }] },
        finishReason: 'STOP',
      }],
    };
    const { gemini } = client([json(body)]);
    const reply = await gemini.rankBatch(ROWS);
    assert.equal(reply.failure, null);
    assert.deepEqual([...reply.rows.keys()], ['r1', 'r2']);
    assert.equal(reply.inputTokens, 0);
  });

  it('reports truncation, refusal, a blocked prompt and bad JSON as failures with their tokens', async () => {
    const cases: [unknown, RegExp][] = [
      [answer(OK_ROWS, { finishReason: 'MAX_TOKENS' }), /truncated/],
      [answer(OK_ROWS, { finishReason: 'SAFETY' }), /declined.*SAFETY/],
      [{ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, usageMetadata: { promptTokenCount: 10 } }, /declined.*PROHIBITED_CONTENT/],
      [{ candidates: [{ content: { parts: [{ text: '{"rows": [' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10 } }, /not valid JSON/],
      [{ candidates: [] }, /no answer/],
    ];
    for (const [body, failure] of cases) {
      const { gemini } = client([json(body)]);
      const reply = await gemini.rankBatch(ROWS);
      assert.match(reply.failure ?? '', failure);
      assert.equal(reply.rows.size, 0);
    }
    const { gemini } = client([json(answer(OK_ROWS, { finishReason: 'MAX_TOKENS' }))]);
    assert.equal((await gemini.rankBatch(ROWS)).inputTokens, 1200);
  });

  it('retries 429 and 5xx, honouring Retry-After and RetryInfo', async () => {
    const quota = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7s' }] } };
    const { gemini, calls, waits } = client([
      json({ error: { code: 503, status: 'UNAVAILABLE' } }, 503, { 'retry-after': '3' }),
      json(quota, 429),
      json({ error: { code: 500 } }, 500),
      json(answer(OK_ROWS)),
    ]);
    const reply = await gemini.rankBatch(ROWS);
    assert.equal(reply.failure, null);
    assert.equal(calls.length, 4);
    // Server-requested delays exactly; then exponential backoff (random() = 1 → full step).
    assert.deepEqual(waits, [3000, 7000, 8000]);
  });

  it('retries network errors and timeouts with growing backoff', async () => {
    const { gemini, calls, waits } = client([new TypeError('fetch failed'), new TypeError('ECONNRESET'), json(answer(OK_ROWS))]);
    const reply = await gemini.rankBatch(ROWS);
    assert.equal(reply.failure, null);
    assert.equal(calls.length, 3);
    assert.deepEqual(waits, [2000, 4000]);
  });

  it('aborts a call that outlives the timeout and retries it', async () => {
    const config = { ...CONFIG, timeoutMs: 20, maxRetries: 1 };
    let attempts = 0;
    const hanging: FetchLike = (_url, init) => {
      attempts++;
      if (attempts > 1) return Promise.resolve(json(answer(OK_ROWS)));
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    };
    const gemini = new GeminiRerankClient(config, { fetch: hanging, sleep: () => Promise.resolve() });
    const reply = await gemini.rankBatch(ROWS);
    assert.equal(reply.failure, null);
    assert.equal(attempts, 2);
  });

  it('gives up after maxRetries and names the last error, never the key', async () => {
    const { gemini, calls } = client([
      json({ error: { code: 503 } }, 503), json({ error: { code: 503 } }, 503),
      json({ error: { code: 503 } }, 503), json({ error: { code: 503 } }, 503),
    ]);
    await assert.rejects(gemini.rankBatch(ROWS), (error: Error) => {
      assert.match(error.message, /gemini HTTP 503.*after 4 attempts/);
      assert.ok(!error.message.includes('test-key'));
      return true;
    });
    assert.equal(calls.length, 4);
  });

  it('does not retry a bad request, a daily quota or a delay longer than MAX_WAIT_MS', async () => {
    const bad = client([json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload' } }, 400)]);
    await assert.rejects(bad.gemini.rankBatch(ROWS), /HTTP 400 INVALID_ARGUMENT: Invalid JSON payload/);
    assert.equal(bad.calls.length, 1);

    const daily = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } };
    const perDay = client([json(daily, 429)]);
    await assert.rejects(perDay.gemini.rankBatch(ROWS), /daily quota/);
    assert.equal(perDay.calls.length, 1);

    const long = client([json({ error: { code: 429 } }, 429, { 'retry-after': String(MAX_WAIT_MS / 1000 + 1) })]);
    await assert.rejects(long.gemini.rankBatch(ROWS), /retry in 91s/);
    assert.equal(long.calls.length, 1);
  });

  it('reads Retry-After as seconds or a date, and RetryInfo as seconds', () => {
    const now = Date.parse('2026-10-28T10:00:00Z');
    assert.equal(retryDelayMs(new Headers({ 'retry-after': '2' }), undefined, now), 2000);
    assert.equal(retryDelayMs(new Headers({ 'retry-after': 'Wed, 28 Oct 2026 10:00:05 GMT' }), undefined, now), 5000);
    assert.equal(retryDelayMs(new Headers(), { error: { details: [{ retryDelay: '1.5s' }] } }, now), 1500);
    assert.equal(retryDelayMs(new Headers(), undefined, now), null);
  });
});

describe('Gemini through the batched reranker', () => {
  it('turns replies into verdicts and accounts usage, cost and p50 latency', async () => {
    const { gemini } = client([json(answer(OK_ROWS)), json(answer([{ id: 'r1', none: false, ranking: [{ code: B, confidence: 0.8, reason: 'B.' }] }]))]);
    const reranker = new BatchedReranker(gemini, { model: CONFIG.model, batchSize: 2, batchWaitMs: 1, price: CONFIG.price });
    const [first, second] = await Promise.all([reranker.rerank(request('Guruch')), reranker.rerank(request('Shakar'))]);
    assert.equal(first?.[0]?.code, A);
    assert.ok(second?.every((v) => v.confidence === 0), 'none scores every offered code at 0');
    const third = await reranker.rerank(request('Un'));
    assert.equal(third[0]?.code, B);

    const usage = reranker.usage();
    assert.equal(usage.apiCalls, 2);
    assert.equal(usage.inputTokens, 2400);
    assert.equal(usage.outputTokens, 400);
    // 2,400 × $0.30 + 400 × $2.50 per million tokens.
    assert.ok(Math.abs((usage.estimatedCostUsd ?? 0) - 0.00172) < 1e-9);
    assert.equal(typeof usage.batchLatencyP50Ms, 'number');
    assert.match(formatLlmUsage(usage, 3), /p50 per call/);
  });

  it('rejects the rows of a call that failed after its retries', async () => {
    const { gemini } = client([json({ error: { code: 400 } }, 400)]);
    const reranker = new BatchedReranker(gemini, { model: CONFIG.model, batchSize: 2, batchWaitMs: 1, price: CONFIG.price });
    await assert.rejects(reranker.rerank(request('Guruch')), /HTTP 400/);
    assert.equal(reranker.usage().rowsFailed, 1);
    assert.equal(reranker.usage().batchLatencyP50Ms, null);
  });
});
