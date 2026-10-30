// The Didox client against the local fake server: both auth header models, paging, retries,
// timeouts, error mapping, and that no token reaches a log line. Live Didox is touched only by the
// opt-in test at the end (DIDOX_LIVE=1), on the public measures list.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { DidoxApiError, DidoxClient, RateLimiter } from './client.js';
import { fixtureDocuments, startFakeDidox, type FakeDidox, type FakeDocument } from './fake-server.js';

const TOKEN = 'secret-user-token-123';
const PARTNER = 'secret-partner-token-456';
const noSleep = (): Promise<void> => Promise.resolve();
const fast = { limiter: new RateLimiter(0), sleep: noSleep };

const servers: FakeDidox[] = [];
async function fake(options: Partial<Parameters<typeof startFakeDidox>[0]> = {}): Promise<FakeDidox> {
  const f = await startFakeDidox({ documents: fixtureDocuments(), auth: { kind: 'token', token: TOKEN }, ...options });
  servers.push(f);
  return f;
}
after(async () => { await Promise.all(servers.map((s) => s.close())); });

describe('DidoxClient (fake server)', () => {
  it('token model: the token travels as api-key and user-key, never in a log line', async () => {
    const f = await fake();
    const lines: string[] = [];
    const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'token', token: TOKEN }, log: (l) => lines.push(l), ...fast });
    assert.deepEqual(client.authHeaders(), { 'api-key': TOKEN, 'user-key': TOKEN });
    const entries = await client.listDocuments({ owner: 0, doctype: '002', page: 1, limit: 10 });
    assert.equal(entries.length, 4, 'the act (005) is filtered by doctype');
    assert.ok(f.requests.every((r) => r.authorized));
    assert.ok(lines.length > 0);
    assert.ok(lines.every((l) => !l.includes(TOKEN) && !l.includes('?')), lines.join('\n'));
  });

  // The official docs (RESEARCH.md §1.2) send the partner token as `Partner-Authorization`; the
  // npm SDK's `Authorization: Bearer` this test first asserted is refused by the partner API.
  it('partner model: Partner-Authorization partner token plus user-key', async () => {
    const f = await fake({ auth: { kind: 'partner', partnerToken: PARTNER, userToken: TOKEN } });
    const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'partner', partnerToken: PARTNER, userToken: TOKEN }, ...fast });
    assert.deepEqual(client.authHeaders(), { 'Partner-Authorization': PARTNER, 'user-key': TOKEN });
    const doc = await client.getDocument('6a1f0c0e2b9d4c0012ab34cd');
    assert.ok(doc && typeof doc === 'object');
    // The other model is refused by this server: 401 → unauthorized, no retry.
    const wrong = new DidoxClient({ baseUrl: f.url, auth: { kind: 'token', token: TOKEN }, ...fast });
    await assert.rejects(wrong.listDocuments({ owner: 0 }), (e: unknown) => e instanceof DidoxApiError && e.code === 'unauthorized' && e.status === 401 && !e.message.includes(TOKEN));
  });

  it('measures/all needs no auth and maps ids to names', async () => {
    const f = await fake();
    const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'none' }, ...fast });
    const measures = await client.measures();
    assert.ok(measures.some((m) => m.measureId === '38' && m.name === 'упаковка'));
  });

  it('pages until a short page, with either list shape', async () => {
    const many: FakeDocument[] = Array.from({ length: 23 }, (_, i) => ({ ...fixtureDocuments()[0]!, id: `doc-${String(i).padStart(2, '0')}`, updated: `2026-10-${String(i + 1).padStart(2, '0')}` }));
    for (const listShape of ['data', 'array'] as const) {
      const f = await fake({ documents: many, listShape });
      const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'token', token: TOKEN }, ...fast });
      const pages: string[][] = [];
      for await (const page of client.listAll({ owner: 0, doctype: '002', limit: 10 })) pages.push(page.map((p) => p.id));
      assert.deepEqual(pages.map((p) => p.length), [10, 10, 3], listShape);
      assert.equal(new Set(pages.flat()).size, 23);
      assert.deepEqual(f.requests.map((r) => r.query['page']), ['1', '2', '3']);
      assert.equal(f.requests[0]?.query['owner'], '0');
    }
  });

  it('stops at maxPages', async () => {
    const many: FakeDocument[] = Array.from({ length: 30 }, (_, i) => ({ ...fixtureDocuments()[0]!, id: `d${i}`, updated: '2026-10-01' }));
    const f = await fake({ documents: many });
    const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'token', token: TOKEN }, ...fast });
    let n = 0;
    for await (const page of client.listAll({ owner: 0, limit: 10 }, 2)) n += page.length;
    assert.equal(n, 20);
  });

  it('retries on 5xx and on 429 (Retry-After), then succeeds', async () => {
    const f = await fake({ failFirst: 2 });
    const waits: number[] = [];
    const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'token', token: TOKEN }, retries: 2, limiter: new RateLimiter(0), sleep: (ms) => { waits.push(ms); return Promise.resolve(); } });
    assert.equal((await client.measures()).length > 0, true);
    assert.equal(f.requests.length, 3);
    assert.deepEqual(waits, [300, 600]);

    const g = await fake({ rateLimitFirst: true });
    const waits2: number[] = [];
    const c2 = new DidoxClient({ baseUrl: g.url, auth: { kind: 'none' }, limiter: new RateLimiter(0), sleep: (ms) => { waits2.push(ms); return Promise.resolve(); } });
    await c2.measures();
    assert.deepEqual(waits2, [1000, 300], 'Retry-After 1 s, then the backoff');
  });

  it('gives up after the retries with the server error', async () => {
    const f = await fake({ failFirst: 10 });
    const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'token', token: TOKEN }, retries: 1, ...fast });
    await assert.rejects(client.measures(), (e: unknown) => e instanceof DidoxApiError && e.code === 'server' && e.status === 500);
    assert.equal(f.requests.length, 2);
  });

  it('times out a slow answer', async () => {
    const f = await fake({ delayMs: 300 });
    const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'none' }, timeoutMs: 50, retries: 0, ...fast });
    await assert.rejects(client.measures(), (e: unknown) => e instanceof DidoxApiError && e.code === 'timeout');
  });

  it('network error when nothing listens', async () => {
    const client = new DidoxClient({ baseUrl: 'http://127.0.0.1:9', auth: { kind: 'none' }, retries: 0, ...fast });
    await assert.rejects(client.measures(), (e: unknown) => e instanceof DidoxApiError && (e.code === 'network' || e.code === 'timeout'));
  });

  it('404 for an unknown document; the print form decodes to a PDF', async () => {
    const f = await fake();
    const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'token', token: TOKEN }, ...fast });
    await assert.rejects(client.getDocument('nope'), (e: unknown) => e instanceof DidoxApiError && e.code === 'not_found');
    const pdf = await client.getDocumentPdf('6a1f0c0e2b9d4c0012ab34cd');
    assert.equal(pdf?.subarray(0, 5).toString('latin1'), '%PDF-');
  });

  // A wrong password is 422 "Incorrect login" per the official docs (RESEARCH.md §1.2), not the 401 first assumed.
  it('password login answers the token; a wrong password is refused with Didox\'s words', async () => {
    const f = await fake({ passwords: { '302345678': { password: 'pw', token: 'issued-token' } } });
    const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'none' }, ...fast });
    assert.deepEqual(await client.loginWithPassword('302345678', 'pw'), { token: 'issued-token' });
    await assert.rejects(client.loginWithPassword('302345678', 'bad'), (e: unknown) => e instanceof DidoxApiError && e.code === 'unprocessable' && e.detail === 'Incorrect login');
  });

  it('the rate limiter spaces calls of one org and not of another', async () => {
    const limiter = new RateLimiter(100);
    const slept: number[] = [];
    const sleep = (ms: number): Promise<void> => { slept.push(ms); return Promise.resolve(); };
    await limiter.wait('org-a', sleep);
    await limiter.wait('org-a', sleep);
    await limiter.wait('org-b', sleep);
    assert.equal(slept.length, 1);
    assert.ok((slept[0] ?? 0) > 50 && (slept[0] ?? 0) <= 100);
  });
});

describe('DidoxClient (live, opt-in: DIDOX_LIVE=1)', { skip: process.env['DIDOX_LIVE'] === '1' ? false : 'set DIDOX_LIVE=1 to call api.didox.uz' }, () => {
  it('GET /v1/measures/all on api.didox.uz answers without auth', async () => {
    const client = new DidoxClient({ baseUrl: 'https://api.didox.uz', auth: { kind: 'none' }, retries: 1 });
    const measures = await client.measures();
    assert.ok(measures.length > 5, `got ${measures.length}`);
    assert.ok(measures.some((m) => m.measureId === '1'));
  });
});
