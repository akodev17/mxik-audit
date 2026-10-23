// The Tasnif client against recorded answers and a fake fetch: parsing, not-found, retries,
// timeouts, the cache, the rate limiter and the kill switch. Never touches the network.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { productNameKey, unitKeyOf, barcodeKey, mxikOf, numbersOf } from './keys.js';
import { gtin13, RECORDED_CODE, recordedBody } from './test-fixtures.js';
import { DisabledTasnifClient, HttpTasnifClient, readCard, readHistory, tasnifLive } from './tasnif-client.js';

type Reply = { status: number; body: unknown } | Error;

/** A fetch that answers from a script of replies per URL fragment, counting calls and peak concurrency. */
function scriptedFetch(script: (url: string, n: number) => Reply | Promise<Reply>) {
  const stats = { calls: 0, inFlight: 0, peak: 0 };
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    stats.calls++;
    stats.inFlight++;
    stats.peak = Math.max(stats.peak, stats.inFlight);
    try {
      const reply = await script(url, stats.calls);
      if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (reply instanceof Error) throw reply;
      return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), { status: reply.status });
    } finally {
      stats.inFlight--;
    }
  }) as typeof fetch;
  return { fetchFn, stats };
}

const noSleep = (): Promise<void> => Promise.resolve();

describe('product keys', () => {
  it('keeps sizes apart and folds spelling', () => {
    assert.notEqual(productNameKey('Coca-Cola 1,5л'), productNameKey('Coca-Cola 0,5л'));
    assert.equal(productNameKey('Цемент М-400 50кг'), productNameKey('цемент  м 400 50 КГ'));
    assert.equal(productNameKey('Oʻrik quritilgan'), productNameKey("O'rik  quritilgan"));
    assert.equal(numbersOf(productNameKey('Coca-Cola 1,5 л')), '1 5');
  });

  it('keys units by their official id', () => {
    assert.equal(unitKeyOf('шт'), unitKeyOf('dona'));
    assert.equal(unitKeyOf('кг'), '5');
    assert.equal(unitKeyOf(null), '');
    assert.equal(unitKeyOf('коробка'), 'коробка');
  });

  it('stores a valid GTIN as GTIN-14 and keeps a bad one without matching on it', () => {
    const good = gtin13('478000000100');
    assert.deepEqual(barcodeKey(good), { stored: `0${good}`, identity: `0${good}` });
    const bad = `${good.slice(0, 12)}${(Number(good.slice(12)) + 1) % 10}`;
    assert.deepEqual(barcodeKey(bad), { stored: bad, identity: null });
    assert.deepEqual(barcodeKey('  '), { stored: null, identity: null });
  });

  it('reads an MXIK and flags anything that is not 17 digits', () => {
    assert.deepEqual(mxikOf('03004413004009066'), { code: '03004413004009066', malformed: false });
    assert.deepEqual(mxikOf('030 0441 3004 009 066'), { code: '03004413004009066', malformed: false });
    assert.deepEqual(mxikOf('1234'), { code: null, malformed: true });
    assert.deepEqual(mxikOf(null), { code: null, malformed: false });
  });
});

describe('Tasnif answers', () => {
  it('reads the recorded card with its three packages', () => {
    const card = readCard(recordedBody('card'), RECORDED_CODE);
    assert.ok(card);
    assert.equal(card.label, 1);
    assert.deepEqual(card.packages.map((p) => [p.code, p.parentCode, p.containerName, p.unitId, p.parentValue]), [
      ['1074787', '1070335', 'упаковка', 1, 1],
      ['1070335', '1062101', 'флакон', 1, 14],
      ['1062101', null, null, 1, 1],
    ]);
  });

  it('reads isActive and status from the recorded history', () => {
    const h = readHistory(recordedBody('history'), RECORDED_CODE);
    assert.ok(h);
    assert.equal(h.isActive, true);
    assert.equal(h.status, 0);
    assert.equal(h.packageNames.length, 3);
    assert.match(h.packageNames.find((n) => n.code === '1074787')?.nameRu ?? '', /^упаковка=1 флакон/);
  });

  it('reads "0" as inactive and a failed envelope as not found', () => {
    const body = recordedBody('history') as { data: Record<string, unknown> };
    assert.equal(readHistory({ ...body, data: { ...body.data, isActive: '0' } }, RECORDED_CODE)?.isActive, false);
    assert.equal(readHistory({ success: false, code: 0, reason: 'Mxik code not found!', data: null }, RECORDED_CODE), null);
    assert.equal(readCard("MXIK ma'lumotlari topilmadi", RECORDED_CODE), null);
  });
});

describe('HttpTasnifClient', () => {
  it('answers from the API, then from its cache', async () => {
    const { fetchFn, stats } = scriptedFetch(() => ({ status: 200, body: recordedBody('card') }));
    const client = new HttpTasnifClient({ fetch: fetchFn, sleep: noSleep });
    const a = await client.card(RECORDED_CODE);
    const b = await client.card(RECORDED_CODE);
    assert.ok(a.ok && b.ok);
    assert.equal(stats.calls, 1);
  });

  it('says not_found for an unknown code and remembers it', async () => {
    const { fetchFn, stats } = scriptedFetch(() => ({ status: 200, body: { success: false, code: 0, reason: 'Mxik code not found!', data: null } }));
    const client = new HttpTasnifClient({ fetch: fetchFn, sleep: noSleep });
    assert.deepEqual(await client.history('12345678901234567'), { ok: false, reason: 'not_found' });
    await client.history('12345678901234567');
    assert.equal(stats.calls, 1);
  });

  it('retries a 5xx and a network error, then succeeds', async () => {
    const { fetchFn, stats } = scriptedFetch((_, n) => (n === 1 ? { status: 502, body: 'bad gateway' } : n === 2 ? new Error('ECONNRESET') : { status: 200, body: recordedBody('history') }));
    const client = new HttpTasnifClient({ fetch: fetchFn, sleep: noSleep, retries: 2 });
    const answer = await client.history(RECORDED_CODE);
    assert.ok(answer.ok);
    assert.equal(stats.calls, 3);
  });

  it('gives up as unavailable after the retries, and does not cache the outage', async () => {
    const { fetchFn, stats } = scriptedFetch(() => ({ status: 503, body: '' }));
    const client = new HttpTasnifClient({ fetch: fetchFn, sleep: noSleep, retries: 1 });
    const answer = await client.card(RECORDED_CODE);
    assert.equal(answer.ok, false);
    assert.equal(!answer.ok && answer.reason, 'unavailable');
    await client.card(RECORDED_CODE);
    assert.equal(stats.calls, 4);
  });

  it('times a slow answer out', async () => {
    const { fetchFn } = scriptedFetch(() => new Promise((resolve) => setTimeout(() => resolve({ status: 200, body: recordedBody('card') }), 200)));
    const client = new HttpTasnifClient({ fetch: fetchFn, sleep: noSleep, retries: 0, timeoutMs: 20 });
    const answer = await client.card(RECORDED_CODE);
    assert.deepEqual(answer, { ok: false, reason: 'unavailable', detail: 'timeout' });
  });

  it('keeps at most `concurrency` requests in flight', async () => {
    const { fetchFn, stats } = scriptedFetch(() => new Promise((resolve) => setTimeout(() => resolve({ status: 200, body: { success: false } }), 5)));
    const client = new HttpTasnifClient({ fetch: fetchFn, concurrency: 2, minGapMs: 0 });
    await Promise.all(Array.from({ length: 10 }, (_, i) => client.history(String(10_000_000_000_000_000 + i))));
    assert.equal(stats.calls, 10);
    assert.ok(stats.peak <= 2, `peak ${stats.peak}`);
  });

  it('is off with TASNIF_LIVE=false', async () => {
    assert.equal(tasnifLive({ TASNIF_LIVE: 'false' }), false);
    assert.equal(tasnifLive({}), true);
    const off = new DisabledTasnifClient();
    assert.equal(off.live, false);
    assert.deepEqual(await off.card(), { ok: false, reason: 'disabled' });
  });
});
