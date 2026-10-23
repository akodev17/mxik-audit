import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { READ_EXTENSIONS, UPLOAD_ACCEPT, UPLOAD_EXTENSIONS } from './upload';

describe('upload extensions', () => {
  it('B20: the drop zone lists only what is read, while .xls is still accepted for its "save as .xlsx" message', () => {
    assert.deepEqual([...READ_EXTENSIONS], ['.xlsx', '.csv']);
    assert.ok((UPLOAD_EXTENSIONS as readonly string[]).includes('.xls'));
    assert.ok(UPLOAD_ACCEPT.split(',').includes('.xls'));
  });
});
