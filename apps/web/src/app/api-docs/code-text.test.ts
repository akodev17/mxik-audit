import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { splitCode } from './code-text.js';

const codes = (text: string): string[] => splitCode(text).filter((p) => p.code).map((p) => p.text);

describe('API docs prose: identifiers as code', () => {
  it('marks paths, fields, headers and error codes, and keeps the words around them', () => {
    const text = 'POST /api/v1/check va /check Idempotency-Key oladi; nextCursor null boʻlsa, 400 invalid_request.';
    assert.deepEqual(codes(text), ['/api/v1/check', '/check', 'Idempotency-Key', 'nextCursor', 'null', 'invalid_request']);
    assert.equal(splitCode(text).map((p) => p.text).join(''), text);
  });

  it('does not mark parts of longer words or Cyrillic text', () => {
    assert.deepEqual(codes('limitlar va statuslar'), []);
    assert.deepEqual(codes('Значение cursor и лимит'), ['cursor']);
    assert.deepEqual(codes('Idempotent-Replayed: true sarlavhasi'), ['Idempotent-Replayed: true']);
  });
});
