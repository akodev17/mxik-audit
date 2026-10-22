import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openApiSpec } from '@tasnivo/domain/api/openapi';
import { apiConfig } from '@tasnivo/domain/api/limits';
import { buildOpenApi } from './openapi';
import { allEndpoints } from './registry';

type Json = Record<string, unknown>;
const ORIGIN = 'https://example.test';

describe('OpenAPI: the public contract does not change', () => {
  it('scope "public" is the document /api/v1/openapi.json serves today, value for value', () => {
    assert.deepEqual(buildOpenApi({ origin: ORIGIN, scope: 'public' }), openApiSpec(ORIGIN));
  });

  it('follows the configured limits like the old document', () => {
    const config = apiConfig({ API_RATE_PER_MINUTE: '7', API_CHECK_MAX_ITEMS: '3' });
    assert.deepEqual(buildOpenApi({ origin: ORIGIN, scope: 'public', config }), openApiSpec(ORIGIN, config));
  });

  it('the /api/v1 part of the full document equals it too: paths, schemas, version 1.1.0', () => {
    const full = buildOpenApi({ origin: ORIGIN }) as unknown as Json;
    const spec = openApiSpec(ORIGIN) as unknown as Json;
    const paths = full['paths'] as Json;
    const v1 = Object.fromEntries(Object.entries(paths).filter(([p]) => p.startsWith('/api/v1/')));
    assert.deepEqual(v1, spec['paths']);
    assert.equal((full['info'] as Json)['version'], '1.1.0');
    assert.equal(full['openapi'], '3.0.3');
    const fullComponents = full['components'] as Record<string, Json>;
    const specComponents = spec['components'] as Record<string, Json>;
    for (const [name, schema] of Object.entries(specComponents['schemas'] ?? {})) {
      assert.deepEqual(fullComponents['schemas']?.[name], schema, `components.schemas.${name}`);
    }
    for (const part of ['parameters', 'headers'] as const) assert.deepEqual(fullComponents[part], specComponents[part], part);
    assert.deepEqual((fullComponents['securitySchemes'] ?? {})['bearerAuth'], (specComponents['securitySchemes'] ?? {})['bearerAuth']);
    assert.deepEqual(full['security'], spec['security']);
  });

  it('documents every endpoint but the document itself, under unique operation ids', () => {
    const full = buildOpenApi({ origin: ORIGIN }) as unknown as { paths: Record<string, Record<string, Json>> };
    const ops = Object.values(full.paths).flatMap((item) => Object.values(item));
    const ids = ops.map((op) => op['operationId'] as string);
    assert.equal(new Set(ids).size, ids.length);
    const expected = allEndpoints().filter((e) => e.documented !== false).map((e) => e.operationId);
    assert.deepEqual([...ids].sort(), [...expected].sort());
  });

  it('first-party mutations document the CSRF header and their session guard', () => {
    const full = buildOpenApi({ origin: ORIGIN }) as unknown as { paths: Record<string, Record<string, Json>> };
    const op = full.paths['/api/catalogs/preview']?.['post'];
    assert.ok(op);
    const params = op['parameters'] as Json[];
    assert.ok(params.some((p) => p['name'] === 'X-Requested-With' && p['in'] === 'header' && p['required'] === true));
    assert.deepEqual(op['security'], [{ cookieAuth: [] }]);
    const body = ((op['requestBody'] as Json)['content'] as Record<string, Json>)['multipart/form-data']?.['schema'] as Json;
    assert.deepEqual(body['required'], ['file']);
    assert.equal(((body['properties'] as Record<string, Json>)['file'] ?? {})['x-max-bytes'], 20 * 1024 * 1024);
  });

  it('every schema reference resolves', () => {
    const full = buildOpenApi({ origin: ORIGIN });
    const names = new Set(Object.keys(full.components.schemas));
    const refs = JSON.stringify(full).match(/#\/components\/schemas\/[A-Za-z]+/g) ?? [];
    for (const r of refs) assert.ok(names.has(r.split('/').pop() ?? ''), r);
  });
});
