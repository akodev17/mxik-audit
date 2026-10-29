// The capped body readers and the upload slots on fake requests: no database, no HTTP server.
import '../setup-env';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import { ApiError } from '../../src/http/errors';
import type { ApiRequest } from '../../src/http/request';
import { readFormData, readFormFields, readJson, readText } from '../../src/http/request-body';
import { takeUploadSlot, UploadSlots } from '../../src/http/upload-slots';

/** A request whose body streams in `chunks`; `declared` sets Content-Length. */
function bodyReq(chunks: (string | Buffer)[], init: { declared?: number; path?: string; type?: string } = {}): ApiRequest {
  const stream = Readable.from(chunks.map((c) => (typeof c === 'string' ? Buffer.from(c) : c)));
  const headers: Record<string, string> = { 'content-type': init.type ?? 'text/plain' };
  if (init.declared !== undefined) headers['content-length'] = String(init.declared);
  return Object.assign(stream, { headers, path: init.path ?? '/api/test', body: undefined, complete: true, socket: {}, get: () => undefined }) as unknown as ApiRequest;
}

const tooLarge = (status = 413) => (error: unknown): boolean => error instanceof ApiError && error.status === status && error.code === 'too_large';

describe('capped request bodies', () => {
  it('reads a body within its cap as before', async () => {
    assert.equal(await readText(bodyReq(['abc', 'def']), { maxBytes: 6 }), 'abcdef');
    assert.deepEqual(await readJson(bodyReq(['{"a":', '1}']), { maxBytes: 64 }), { json: { a: 1 } });
    assert.equal(await readJson(bodyReq(['not json'])), null);
    assert.deepEqual(await readFormFields(bodyReq(['a=1&b=2']), { maxBytes: 64 }), { a: '1', b: '2' });
  });

  it('refuses a body that grows past the cap with 413, and drops what it read', async () => {
    await assert.rejects(readText(bodyReq(['abc', 'def', 'g']), { maxBytes: 6 }), tooLarge());
    await assert.rejects(readJson(bodyReq(['x'.repeat(40), 'y'.repeat(40)]), { maxBytes: 64 }), tooLarge());
    await assert.rejects(readFormFields(bodyReq(['a='.padEnd(2 * 1024 * 1024, 'x')])), tooLarge(), 'default cap 1 MB');
  });

  it('refuses a declared Content-Length over the cap whatever arrives', async () => {
    await assert.rejects(readText(bodyReq(['ab'], { declared: 10_000 }), { maxBytes: 100 }), tooLarge());
  });

  it('answers the v1 envelope code on /api/v1', async () => {
    const form = bodyReq(['--b\r\n', 'x'.repeat(200)], { path: '/api/v1/catalogs', type: 'multipart/form-data; boundary=b' });
    await assert.rejects(readFormData(form, { maxBytes: 100 }), (e: unknown) => e instanceof ApiError && e.status === 413 && e.code === 'too_large' && e.message === 'The request body is too large.');
  });

  it('reads multipart within the cap into FormData', async () => {
    const body = '--b\r\nContent-Disposition: form-data; name="contact"\r\n\r\n@ali\r\n--b--\r\n';
    const form = await readFormData(bodyReq([body], { type: 'multipart/form-data; boundary=b' }), { maxBytes: 1024 });
    assert.equal(form?.get('contact'), '@ali');
  });
});

describe('upload slots', () => {
  it('two per key and eight in all; a release frees one, twice is harmless', () => {
    const slots = new UploadSlots({ perOrg: 2, perProcess: 8 });
    const a1 = slots.take('org:a');
    const a2 = slots.take('org:a');
    assert.ok(a1 && a2);
    assert.equal(slots.take('org:a'), null, 'a third for the same org waits');
    a1();
    a1();
    assert.equal(slots.inUse, 1);
    assert.ok(slots.take('org:a'), 'a freed slot is taken again');
    const others = Array.from({ length: 6 }, (_, i) => slots.take(`org:o${i}`));
    assert.ok(others.every(Boolean));
    assert.equal(slots.inUse, 8);
    assert.equal(slots.take('org:new'), null, 'the process is full');
  });

  it('a busy request is the 429 with Retry-After, keyed by org or else by address', () => {
    const slots = new UploadSlots({ perOrg: 1, perProcess: 8 });
    const req = { path: '/api/catalogs/preview', headers: {}, user: { orgId: 'o1' }, get: () => undefined, socket: { remoteAddress: '10.0.0.1' } } as unknown as ApiRequest;
    const release = takeUploadSlot(req, slots);
    assert.throws(() => takeUploadSlot(req, slots), (e: unknown) => e instanceof ApiError && e.status === 429 && e.code === 'rate_limited' && e.headers['Retry-After'] === '5');
    const anonymous = { ...req, user: null } as unknown as ApiRequest;
    takeUploadSlot(anonymous, slots)();
    release();
    takeUploadSlot(req, slots)();
  });
});
