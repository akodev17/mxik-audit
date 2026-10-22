import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkResultOut } from './check';
import { ERROR_CODES, ERROR_STATUS, HEADERS, OPERATION_IDS, OPERATIONS } from './contract';
import { openApiSpec } from './openapi';
import { catalogOut, findingOut, reportOut, uploadOut } from './serialize';

type Json = Record<string, unknown>;
const spec = openApiSpec('https://example.test') as unknown as Json;
const at = (obj: unknown, ...keys: string[]): Json => keys.reduce<unknown>((o, k) => (o as Json)[k], obj) as Json;
const schema = (name: string): Json => at(spec, 'components', 'schemas', name);
const props = (name: string): string[] => Object.keys(at(schema(name), 'properties')).sort();
const keys = (value: unknown): string[] => Object.keys(value as Json).sort();

const catalog = { id: 'c1', filename: 'k.xlsx', clientId: 'cl1', createdAt: new Date('2026-10-01T00:00:00Z'), status: 'ready', rowCount: 3, progressDone: 3 };
const finding = {
  id: 'f1', type: 'MISSING', severity: 'high', suggestedMxik: null, confidence: 0.5, reason: 'r', decision: 'pending', chosenMxik: null, decisionSource: 'manual',
  item: { rowIndex: 0, rawName: 'Sut', barcode: null, unit: null, existingMxik: null },
};

describe('OpenAPI document and handlers agree', () => {
  it('documents exactly the statuses each operation can answer', () => {
    for (const id of OPERATION_IDS) {
      const op = OPERATIONS[id];
      const responses = at(spec, 'paths', op.path, op.method, 'responses');
      const expected = new Set([String(op.success), ...op.errors.map((c) => String(ERROR_STATUS[c]))]);
      assert.deepEqual(new Set(Object.keys(responses)), expected, id);
      const documented = Object.values(responses).flatMap((r) => ((r as Json)['x-error-codes'] as string[] | undefined) ?? []);
      assert.deepEqual(new Set(documented), new Set(op.errors), `${id} error codes`);
    }
  });

  it('every operation can answer the entry errors and a server error', () => {
    for (const id of OPERATION_IDS) {
      for (const code of ['unauthorized', 'rate_limited', 'server_error'] as const) {
        assert.ok((OPERATIONS[id].errors as readonly string[]).includes(code), `${id}: ${code}`);
      }
    }
  });

  it('the error envelope lists every code', () => {
    const code = at(schema('Error'), 'properties', 'error', 'properties', 'code');
    assert.deepEqual(code['enum'], ERROR_CODES);
  });

  it('rate-limit headers are documented on success and on every error after authentication', () => {
    for (const id of OPERATION_IDS) {
      const op = OPERATIONS[id];
      for (const [status, response] of Object.entries(at(spec, 'paths', op.path, op.method, 'responses'))) {
        const headers = Object.keys(((response as Json)['headers'] as Json | undefined) ?? {});
        if (status === '401') { assert.deepEqual(headers, [], `${id} 401`); continue; }
        assert.ok(headers.includes(HEADERS.limit) && headers.includes(HEADERS.remaining), `${id} ${status}`);
      }
    }
  });

  it('idempotent operations take the Idempotency-Key header; paged ones take limit and cursor', () => {
    for (const id of OPERATION_IDS) {
      const op = OPERATIONS[id];
      const params = (at(spec, 'paths', op.path, op.method)['parameters'] as Json[]).map((p) => (p['$ref'] as string | undefined) ?? (p['name'] as string));
      assert.equal(params.includes('#/components/parameters/IdempotencyKey'), op.idempotent, id);
      assert.equal(params.includes('limit') && params.includes('cursor'), op.paginated, id);
    }
  });

  it('schemas list exactly the keys the serializers return', () => {
    assert.deepEqual(props('Catalog'), keys(catalogOut(catalog)));
    assert.deepEqual(props('Finding'), keys(findingOut(finding)));
    assert.deepEqual(props('Report'), keys(reportOut({ catalog, summary: {}, findings: [], nextCursor: null })));
    assert.deepEqual(props('UploadAccepted'), keys(uploadOut({ id: 'c1', rows: 3, clientId: 'cl1' })));
    const result = checkResultOut('Sut', { markingRequired: false, findings: [{ type: 'MISSING', severity: 'high', suggestedMxik: null, confidence: null, reason: 'r', alternatives: [{ code: 'x', name: 'y', confidence: 0.1 }] }] });
    assert.deepEqual(props('CheckResult'), keys(result));
    assert.deepEqual(props('CheckFinding'), keys(result.findings[0]));
    assert.deepEqual(props('Alternative'), keys(result.findings[0]?.alternatives[0]));
    assert.deepEqual(props('CatalogList'), ['catalogs', 'nextCursor']);
  });

  it('an unknown decision source is sent as null, never as a free string', () => {
    assert.equal(findingOut({ ...finding, decisionSource: 'something' }).decisionSource, null);
  });

  it('a failed audit reports that it failed without internal details', () => {
    const failed = reportOut({ catalog: { ...catalog, status: 'failed' }, summary: null, findings: [], nextCursor: null });
    assert.equal(typeof failed.error, 'string');
    assert.equal(reportOut({ catalog, summary: null, findings: [], nextCursor: null }).error, null);
  });
});
