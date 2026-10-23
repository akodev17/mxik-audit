import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError, createApiClient, createServerApiClient, filenameFrom } from './index';

type Seen = { url: string; init: RequestInit };

/** A fetch that records the request and answers with `reply`. */
function mockFetch(reply: (seen: Seen) => Response = () => Response.json({ ok: true })) {
  const calls: Seen[] = [];
  const fetch = ((url: string | URL | Request, init: RequestInit = {}) => {
    const seen = { url: url instanceof Request ? url.url : url.toString(), init };
    calls.push(seen);
    return Promise.resolve(reply(seen));
  }) as typeof globalThis.fetch;
  return { fetch, calls, last: () => calls[calls.length - 1]! };
}

const header = (seen: Seen, name: string): string | null => new Headers(seen.init.headers).get(name);

const PREVIEW = {
  catalogId: 'c1', filename: 'k.xlsx', client: { id: 'cl1', name: 'Mijoz' }, headers: ['Nomi'], sample: [['Sut']], rows: 1, parse: null,
  mapping: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1, sales: -1 }, remembered: null,
  fields: { name: 'guess', barcode: 'none', mxik: 'none', unit: 'none', price: 'none', sales: 'none' }, diagnostics: null, previous: null,
};

describe('api-client: URLs and headers', () => {
  it('fills path params, puts query keys in the query string and the rest in the JSON body', async () => {
    const m = mockFetch(() => Response.json({ ok: true, catalogId: 'c 1' }));
    const api = createApiClient({ baseUrl: 'https://api.test/', fetch: m.fetch });
    const out = await api.catalogs.commit({ catalogId: 'c 1', mapping: { name: 0, barcode: -1, mxik: 2, unit: -1, price: -1 } });
    assert.deepEqual(out, { ok: true, catalogId: 'c 1' });
    const seen = m.last();
    assert.equal(seen.url, 'https://api.test/api/catalogs/c%201/commit');
    assert.equal(seen.init.method, 'POST');
    assert.equal(header(seen, 'content-type'), 'application/json');
    assert.deepEqual(JSON.parse(seen.init.body as string), { mapping: { name: 0, barcode: -1, mxik: 2, unit: -1, price: -1 } });
  });

  it('sends X-Requested-With: tasnivo on mutations only, and cookies by default', async () => {
    const m = mockFetch(() => Response.json({ items: [], total: 0, pageSize: 50, clients: [] }));
    const api = createApiClient({ fetch: m.fetch });
    await api.catalogs.list({ clientId: 'cl1', page: 2 });
    assert.equal(m.last().url, '/api/catalogs?clientId=cl1&page=2');
    assert.equal(header(m.last(), 'x-requested-with'), null);
    assert.equal(m.last().init.credentials, 'include');
    assert.equal(header(m.last(), 'accept'), 'application/json');

    const n = mockFetch(() => Response.json(true));
    await createApiClient({ fetch: n.fetch }).auth.endSession({ sid: 's1' });
    assert.equal(n.last().init.method, 'DELETE');
    assert.equal(n.last().url, '/api/auth/sessions/s1');
    assert.equal(header(n.last(), 'x-requested-with'), 'tasnivo');
    assert.equal(n.last().init.body, undefined);
  });

  it('url() builds links for downloads and navigations', () => {
    const api = createApiClient({ baseUrl: 'https://tasnivo.uz' });
    assert.equal(api.catalogs.exportFile.url({ catalog: 'c1', format: '1c' }), 'https://tasnivo.uz/api/export?catalog=c1&format=1c');
    assert.equal(api.share.pdf.url({ token: 'a/b' }), 'https://tasnivo.uz/api/share/a%2Fb/pdf');
    assert.equal(api.auth.verifyEmail.endpoint.path, '/api/auth/verify/{token}');
  });

  it('a missing path parameter never reaches the network', async () => {
    const m = mockFetch();
    const api = createApiClient({ fetch: m.fetch, validate: false });
    await assert.rejects(() => api.catalogs.retry({} as { catalogId: string }), (e: unknown) => e instanceof ApiError && e.code === 'invalid_request');
    assert.equal(m.calls.length, 0);
  });
});

describe('api-client: multipart', () => {
  it('posts a FormData as it is: previewUpload(formData)', async () => {
    const m = mockFetch(() => Response.json({ ok: true, preview: PREVIEW }));
    const api = createApiClient({ fetch: m.fetch });
    const form = new FormData();
    form.append('file', new File(['Nomi\nSut'], 'k.csv', { type: 'text/csv' }));
    form.append('clientId', 'cl1');
    const out = await api.catalogs.previewUpload(form);
    assert.equal(out.ok, true);
    assert.equal(m.last().url, '/api/catalogs/preview');
    assert.equal(m.last().init.body, form);
    assert.equal(header(m.last(), 'content-type'), null, 'fetch sets the multipart boundary itself');
    assert.equal(header(m.last(), 'x-requested-with'), 'tasnivo');
  });

  it('builds the FormData from fields and files, with path params as the second argument', async () => {
    const m = mockFetch(() => Response.json({ ok: false, error: 'Fayl juda katta' }));
    const api = createApiClient({ fetch: m.fetch });
    const out = await api.imports.uploadDoc({ kind: 'sales', file: new Blob(['x']) }, { clientId: 'cl 9' });
    assert.deepEqual(out, { ok: false, error: 'Fayl juda katta' });
    assert.equal(m.last().url, '/api/clients/cl%209/docs');
    const body = m.last().init.body as FormData;
    assert.equal(body.get('kind'), 'sales');
    assert.ok(body.get('file') instanceof Blob);
  });

  it('with validation on, refuses a form without its required file', async () => {
    const m = mockFetch();
    const api = createApiClient({ fetch: m.fetch, validate: true });
    await assert.rejects(() => api.catalogs.previewUpload(new FormData()), /file part "file" is required/);
    assert.equal(m.calls.length, 0);
  });
});

describe('api-client: answers and errors', () => {
  it('turns the error envelope into one ApiError with status, code and message', async () => {
    const m = mockFetch(() => Response.json({ error: { code: 'unauthorized', message: 'Sign in first.' } }, { status: 401 }));
    const api = createApiClient({ fetch: m.fetch });
    await assert.rejects(() => api.auth.me(), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, 401);
      assert.equal(e.code, 'unauthorized');
      assert.equal(e.message, 'Sign in first.');
      return true;
    });
  });

  it('reads the old route handlers\' { error: "text" } and bodies that are not JSON', async () => {
    const legacy = mockFetch(() => Response.json({ error: 'audit not finished' }, { status: 409 }));
    await assert.rejects(() => createApiClient({ fetch: legacy.fetch }).catalogs.exportFile({ catalog: 'c1' }), { status: 409, code: 'audit_not_finished' });
    const html = mockFetch(() => new Response('<h1>Bad gateway</h1>', { status: 502, statusText: 'Bad Gateway' }));
    await assert.rejects(() => createApiClient({ fetch: html.fetch }).health.get(), { status: 502, code: 'http_502', message: 'Bad Gateway' });
  });

  it('a network failure is ApiError status 0, code network', async () => {
    const fetch = (() => Promise.reject(new TypeError('fetch failed'))) as typeof globalThis.fetch;
    await assert.rejects(() => createApiClient({ fetch }).auth.me(), { status: 0, code: 'network', message: 'fetch failed' });
  });

  it('validates answers when asked, and passes them through when not', async () => {
    const wrong = () => Response.json({ userId: 'u1' });
    await assert.rejects(() => createApiClient({ fetch: mockFetch(wrong).fetch, validate: true }).auth.me(), { code: 'invalid_response' });
    assert.deepEqual(await createApiClient({ fetch: mockFetch(wrong).fetch, validate: false }).auth.me(), { userId: 'u1' });
  });

  it('validates requests when asked', async () => {
    const m = mockFetch();
    const api = createApiClient({ fetch: m.fetch, validate: true });
    await assert.rejects(() => api.workspace.decide({ findingId: 'f1', decision: 'maybe' as 'accepted' }), { code: 'invalid_request' });
    assert.equal(m.calls.length, 0);
  });

  it('keeps a scalar answer (booleans, null) as the action returned it', async () => {
    const api = createApiClient({ fetch: mockFetch(() => Response.json(null)).fetch, validate: true });
    assert.equal(await api.workspace.newCodeRequest({ findingId: 'f1' }), null);
    const yes = createApiClient({ fetch: mockFetch(() => Response.json(true)).fetch, validate: true });
    assert.equal(await yes.catalogs.revokeShareLink({ linkId: 'l1' }), true);
  });

  it('health answers its body on 503 too', async () => {
    const body = { status: 'unavailable', database: false, classifier: { loaded: false, takenAt: null, ageDays: null, codeCount: null, stale: false, lastUpdate: null } };
    const m = mockFetch(() => Response.json(body, { status: 503 }));
    assert.deepEqual(await createApiClient({ fetch: m.fetch, validate: true }).health.get(), body);
  });

  it('downloads keep the server\'s file name', async () => {
    const m = mockFetch(() => new Response('a;b', {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="katalog-farq.csv"; filename*=UTF-8\'\'%D0%BA%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3-farq.csv' },
    }));
    const file = await createApiClient({ fetch: m.fetch }).catalogs.exportDiffCsv({ catalog: 'c1' });
    assert.equal(file.filename, 'каталог-farq.csv');
    assert.equal(file.contentType, 'text/csv; charset=utf-8');
    assert.equal(await file.blob.text(), 'a;b');
    assert.equal(filenameFrom('inline; filename="r.pdf"'), 'r.pdf');
    assert.equal(filenameFrom(null), null);
  });
});

describe('api-client: server side (Next SSR)', () => {
  it('forwards the incoming cookie and language, nothing else, and does not use browser credentials', async () => {
    const m = mockFetch(() => Response.json({ userId: 'u1', orgId: 'o1', email: 'a@b.uz', demo: false, clientId: null, role: 'admin', clientIds: null, verified: true }));
    const incoming = new Headers({ cookie: 'mxik_audit_session=sealed', 'accept-language': 'ru', 'x-secret': 'no', host: 'tasnivo.uz' });
    const api = createServerApiClient({ baseUrl: 'http://api:4000', incoming: () => incoming, fetch: m.fetch, validate: true });
    const me = await api.auth.me();
    assert.equal(me.role, 'admin');
    const seen = m.last();
    assert.equal(seen.url, 'http://api:4000/api/auth/me');
    assert.equal(header(seen, 'cookie'), 'mxik_audit_session=sealed');
    assert.equal(header(seen, 'accept-language'), 'ru');
    assert.equal(header(seen, 'x-secret'), null);
    assert.equal(header(seen, 'host'), null);
    assert.equal(seen.init.credentials, 'omit');
  });

  it('reads the headers getter per request (next/headers is async)', async () => {
    let n = 0;
    const m = mockFetch(() => Response.json([]));
    const api = createServerApiClient({ baseUrl: 'http://api:4000', incoming: () => Promise.resolve(new Headers({ cookie: `s=${++n}` })), fetch: m.fetch });
    await api.auth.sessions();
    await api.auth.sessions();
    assert.deepEqual(m.calls.map((c) => header(c, 'cookie')), ['s=1', 's=2']);
  });
});

// Compile-time checks: these lines only have to typecheck (or fail to, where marked).
export function typeChecks(api: ReturnType<typeof createApiClient>): void {
  void (async () => {
    const preview = await api.catalogs.previewUpload(new FormData());
    if (preview.ok) preview.preview.mapping.name.toFixed();
    else preview.error.toUpperCase();
    const me = await api.auth.me();
    me.role satisfies 'admin' | 'accountant' | 'viewer';
    // @ts-expect-error catalogId is required
    await api.catalogs.commit({ mapping: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1 } });
    // @ts-expect-error not a decision
    await api.workspace.decide({ findingId: 'f', decision: 'maybe' });
    const file = await api.catalogs.exportPdf({ catalog: 'c1', audience: 'client' });
    file.blob.size.toFixed();
  });
}
