// The small helpers between a route and the domain call (src/http/payload.ts).
import '../setup-env';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '../../src/http/errors';
import { found, withPath } from '../../src/http/payload';

describe('payload helpers', () => {
  it('withPath merges the path ids over an object body and ignores anything else', () => {
    assert.deepEqual(withPath({ mapping: { name: 0 }, catalogId: 'body' }, { catalogId: 'path' }), { mapping: { name: 0 }, catalogId: 'path' });
    assert.deepEqual(withPath(null, { listId: 'l' }), { listId: 'l' });
    assert.deepEqual(withPath([1, 2], { listId: 'l' }), { listId: 'l' });
    assert.deepEqual(withPath('text', { listId: 'l' }), { listId: 'l' });
  });

  it('found answers 404 for null and undefined only', () => {
    assert.equal(found(0), 0);
    assert.throws(() => found(null), (e: unknown) => e instanceof ApiError && e.status === 404 && e.code === 'not_found');
    assert.throws(() => found(undefined), ApiError);
  });
});
