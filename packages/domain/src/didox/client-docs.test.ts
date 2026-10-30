// The client's behaviours from Didox's official integrator docs (RESEARCH.md §1), one test each,
// against the local fake server that answers in the documented shapes. No database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { DidoxApiError, DidoxClient, didoxBaseUrl, errorDetail, RateLimiter, DIDOX_COMPANY_URL, DIDOX_PARTNER_URL, DIDOX_SANDBOX_URL } from './client.js';
import { parseDidoxDocument } from './document.js';
import { FIXTURE_DIR, fixtureDocuments, startFakeDidox, type FakeDidox, type FakeDocument } from './fake-server.js';
import { readDidoxUpload } from './sources.js';

const TOKEN = 'user-token-777';
const PARTNER = 'partner-token-888';
const fast = { limiter: new RateLimiter(0), sleep: (): Promise<void> => Promise.resolve() };
const servers: FakeDidox[] = [];
async function fake(options: Partial<Parameters<typeof startFakeDidox>[0]> = {}): Promise<FakeDidox> {
  const f = await startFakeDidox({ documents: fixtureDocuments(), auth: { kind: 'token', token: TOKEN }, ...options });
  servers.push(f);
  return f;
}
after(async () => { await Promise.all(servers.map((s) => s.close())); });
const realExport = (): unknown => JSON.parse(readFileSync(join(FIXTURE_DIR, 'real', '01-real-export-1428.json'), 'utf8'));

describe('Didox client per the official docs (fake server)', () => {
  // didox §1.1: production partner host, company host, sandbox, and the override.
  it('hosts: partner, company, sandbox and DIDOX_API_URL', () => {
    assert.equal(didoxBaseUrl({}, 'partner'), DIDOX_PARTNER_URL);
    assert.equal(didoxBaseUrl({}, 'token'), DIDOX_COMPANY_URL);
    assert.equal(didoxBaseUrl({ DIDOX_SANDBOX: '1' }, 'partner'), DIDOX_SANDBOX_URL);
    assert.equal(didoxBaseUrl({ DIDOX_API_URL: 'http://127.0.0.1:4923/', DIDOX_SANDBOX: '1' }, 'partner'), 'http://127.0.0.1:4923');
    assert.equal(DIDOX_PARTNER_URL, 'https://api-partners.didox.uz');
  });

  // didox §1.3 row 1: GET /v2/documents with page and limit (required), owner always sent, doctypes as a list, dateFromUpdated; paging by next_page_url.
  it('pages /v2/documents by next_page_url with the documented filters', async () => {
    const many: FakeDocument[] = Array.from({ length: 25 }, (_, i) => ({ ...fixtureDocuments()[0]!, id: `D${String(i).padStart(2, '0')}`, doctype: i % 5 === 0 ? '008' : '002', updated: `2026-10-${String((i % 28) + 1).padStart(2, '0')}` }));
    const f = await fake({ documents: [...many, { ...fixtureDocuments()[4]!, id: 'ACT', doctype: '005', updated: '2026-10-29' }] });
    const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'token', token: TOKEN }, ...fast });
    const pages: number[] = [];
    for await (const page of client.listAll({ owner: 0, doctype: '002,008,023', dateFromUpdated: '2026-10-05', limit: 10 })) pages.push(page.length);
    // 25 documents updated from day 1 to 25; 21 from 2026-10-05 on, the act (005) left out by doctype.
    assert.deepEqual(pages, [10, 10, 1]);
    const lists = f.requests.filter((r) => r.path === '/v2/documents');
    assert.deepEqual(lists.map((r) => [r.query['page'], r.query['limit'], r.query['owner'], r.query['doctype'], r.query['dateFromUpdated']]), [
      ['1', '10', '0', '002,008,023', '2026-10-05'], ['2', '10', '0', '002,008,023', '2026-10-05'], ['3', '10', '0', '002,008,023', '2026-10-05'],
    ]);
  });

  // didox §1.3 (1C library): a host without v2 answers 404; the client falls back to the v1 list with dateFrom, once.
  it('falls back to the v1 list on a host without /v2/documents', async () => {
    const f = await fake({ v1Only: true });
    const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'token', token: TOKEN }, ...fast });
    const first = await client.listDocuments({ owner: 0, doctype: '002', dateFromUpdated: '2026-10-10', page: 1, limit: 50 });
    await client.listDocuments({ owner: 0, doctype: '002', page: 1, limit: 50 });
    assert.deepEqual(first.map((e) => e.id).sort(), ['6a1f0c0e2b9d4c0012ab34cd', '6a20aa11c0ffee0000000042', '6a20bb22c0ffee0000000077']);
    assert.deepEqual(f.requests.map((r) => r.path), ['/v2/documents', '/v1/documents', '/v1/documents']);
    assert.equal(f.requests[1]?.query['dateFrom'], '2026-10-10');
  });

  // didox §1.3 row 3, §7.12: GET /v1/documents/{id}?owner=0 answers {data:{json, document}}; the parser takes status and signatures from it.
  it('GET document: the documented envelope, read by the parser', async () => {
    const signature = JSON.stringify([{ taxId: '200242936', fullName: 'DIREKTOR F.I.O.', signingTime: '2025.06.30 18:02:11' }]);
    const f = await fake({ documents: [{ id: '05EDC0F656A811F0B9D2FA163E666D9A', doctype: '002', status: '3', owner: 0, updated: '2025-06-30', json: realExport(), metadata: { signature, status_comment: null } }] });
    const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'token', token: TOKEN }, ...fast });
    const doc = await client.getDocument('05EDC0F656A811F0B9D2FA163E666D9A', 0);
    assert.equal(f.requests.at(-1)?.query['owner'], '0');
    const r = parseDidoxDocument(doc, { source: 'didox_api' });
    assert.ok(r.ok);
    assert.deepEqual([r.invoice.envelope, r.invoice.meta.externalId, r.invoice.meta.signed, r.invoice.signers[0]?.signedAt], ['get', '05EDC0F656A811F0B9D2FA163E666D9A', true, '2025-06-30T18:02:11+05:00']);
  });

  // didox §1.3 row 17, §4.1: GET /archive is the export ZIP; the upload reader takes its JSON and print form.
  it('GET archive: the ZIP of JSON, PDF and readme', async () => {
    const f = await fake({ documents: [{ id: '05edc0f656a811f0b9d2fa163e666d9a', doctype: '002', status: '3', owner: 0, updated: '2025-06-30', json: realExport() }] });
    const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'token', token: TOKEN }, ...fast });
    const zip = await client.getArchive('05edc0f656a811f0b9d2fa163e666d9a');
    assert.ok(zip);
    const read = await readDidoxUpload(zip, 'archive.zip');
    assert.ok(read.kind === 'documents');
    assert.equal(read.documents[0]?.entry, '05EDC0F656A811F0B9D2FA163E666D9A.json');
    assert.equal(read.documents[0]?.pdf?.subarray(0, 5).toString('latin1'), '%PDF-');
  });

  // didox §1.2, §1.6, V14: 401 plain text, 422 / 423 / 429 bodies kept verbatim (bounded, never a token).
  it('error bodies are surfaced in Didox\'s own words', async () => {
    const f = await fake();
    const wrong = new DidoxClient({ baseUrl: f.url, auth: { kind: 'token', token: 'stale' }, ...fast });
    await assert.rejects(wrong.listDocuments({ owner: 0 }), (e: unknown) => e instanceof DidoxApiError && e.code === 'unauthorized' && e.detail === 'Unauthorized. Invalid user key');
    const blocked = await fake({ loginError: { status: 423, body: { message: 'Пользователь заблокирован. Обратитесь в техподдержку' } } });
    const anon = new DidoxClient({ baseUrl: blocked.url, auth: { kind: 'none' }, ...fast });
    await assert.rejects(anon.loginWithPassword('302345678', 'pw'), (e: unknown) => e instanceof DidoxApiError && e.code === 'locked' && e.detail === 'Пользователь заблокирован. Обратитесь в техподдержку');
    const busy = await fake({ rateLimitFirst: true });
    const once = new DidoxClient({ baseUrl: busy.url, auth: { kind: 'token', token: TOKEN }, retries: 0, ...fast });
    await assert.rejects(once.listDocuments({ owner: 0 }), (e: unknown) => e instanceof DidoxApiError && e.code === 'rate_limited' && /Слишком много попыток/.test(e.detail ?? ''));
    assert.equal(errorDetail('{"page":["The page field is required."],"limit":["The limit field is required."]}'), 'page: The page field is required.; limit: The limit field is required.');
    assert.equal(errorDetail('{"id":"x-trace","title":"warnings","message":"Нет в приходных документах","description":"ИКПУ 10403003014000001"}'), 'warnings — Нет в приходных документах — ИКПУ 10403003014000001');
    assert.equal(errorDetail(`bad key ${TOKEN}`, [TOKEN]), 'bad key ***');
  });

  // didox §1.2: tokens live 360 minutes; an expired one fails before any request leaves.
  it('an expired token stops the call before it reaches Didox', async () => {
    const f = await fake();
    const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'token', token: TOKEN }, tokenExpiresAt: new Date(Date.now() - 1_000), ...fast });
    await assert.rejects(client.listDocuments({ owner: 0 }), (e: unknown) => e instanceof DidoxApiError && e.code === 'token_expired');
    assert.equal(f.requests.length, 0);
    // The public measures list needs no token at all.
    assert.ok((await new DidoxClient({ baseUrl: f.url, auth: { kind: 'none' }, ...fast }).measures()).length > 0);
  });

  // didox §1.1, §1.2: the sandbox takes the user token alone; the partner API needs Partner-Authorization and the user token.
  it('sandbox user-key auth and the partner header pair', async () => {
    const sandbox = await fake({ auth: { kind: 'user', userToken: TOKEN } });
    const user = new DidoxClient({ baseUrl: sandbox.url, auth: { kind: 'user', userToken: TOKEN }, ...fast });
    assert.deepEqual(user.authHeaders(), { 'user-key': TOKEN });
    assert.ok((await user.listDocuments({ owner: 0, limit: 5 })).length > 0);
    const partner = await fake({ auth: { kind: 'partner', partnerToken: PARTNER, userToken: TOKEN } });
    const p = new DidoxClient({ baseUrl: partner.url, auth: { kind: 'partner', partnerToken: PARTNER, userToken: TOKEN }, ...fast });
    assert.ok((await p.listDocuments({ owner: 0, limit: 5 })).length > 0);
    assert.ok(partner.requests.every((r) => r.authorized && r.headerNames.includes('partner-authorization') && !r.headerNames.includes('authorization')));
  });

  // didox §1.6, V9: the not-creditable and compensation ИКПУ lists of /v1/utils.
  it('reads the restricted ИКПУ lists', async () => {
    const f = await fake({ lists: { notIncluded: ['02523001001000000', 'bad'], compensation: ['10713007001000000'] } });
    const client = new DidoxClient({ baseUrl: f.url, auth: { kind: 'token', token: TOKEN }, ...fast });
    const lists = await client.restrictedLists();
    assert.deepEqual([[...lists.notIncluded], [...lists.compensation]], [['02523001001000000'], ['10713007001000000']]);
    assert.deepEqual(f.requests.map((r) => r.path).sort(), ['/v1/utils/compensation-works/ru', '/v1/utils/not-included-products/ru']);
  });

  // didox §7.5 (review 30 Oct): the API path reads JSON like an upload. Didox mixes numbers and strings per field; a
  // numeric 17-digit ИКПУ above 2^53 or a 20-digit account must reach the parser as the digits written, not a rounded float.
  it('a GET document with numeric long codes keeps every digit', async () => {
    const body = '{"data":{"json":{"facturaid":"F1","seller":{"account": 22510000500000083006},"productlist":{"products":[{"catalogcode":10403003014000001,"summa":12.5}]}}}}';
    const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(body); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const client = new DidoxClient({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, auth: { kind: 'token', token: TOKEN }, ...fast });
      const doc = await client.getDocument('F1', 0) as { data: { json: { seller: { account: unknown }; productlist: { products: Array<{ catalogcode: unknown; summa: unknown }> } } } };
      assert.equal(doc.data.json.productlist.products[0]?.catalogcode, '10403003014000001');
      assert.equal(doc.data.json.seller.account, '22510000500000083006');
      assert.equal(doc.data.json.productlist.products[0]?.summa, 12.5, 'amounts stay numbers');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
