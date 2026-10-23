import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { endpointInfo } from './endpoint-info';

describe('endpointInfo', () => {
  it('reads method, path, status and flags from the contract', () => {
    const check = endpointInfo('check');
    assert.equal(check.method, 'POST');
    assert.equal(check.path, '/api/v1/check');
    assert.equal(check.success, 200);
    assert.equal(check.idempotent, true);
    assert.ok(check.errors.includes('rate_limited'));
    assert.equal(endpointInfo('upload').success, 202);
  });

  it('lists path, query and multipart parameters with whether they are required', () => {
    const report = endpointInfo('report');
    assert.deepEqual(report.params.map((p) => [p.name, p.where, p.required]), [['id', 'path', true], ['limit', 'query', false], ['cursor', 'query', false]]);
    const upload = endpointInfo('upload');
    assert.deepEqual(upload.params.map((p) => [p.name, p.where, p.required]), [['file', 'file', true], ['clientId', 'form', false]]);
    assert.deepEqual(endpointInfo('list').params.map((p) => p.name), ['limit', 'cursor', 'clientId']);
  });
});
