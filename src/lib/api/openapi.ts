// OpenAPI 3.0 description of the public API, served at /api/v1/openapi.json.
const error = { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
const bearer = [{ bearerAuth: [] }];

export function openApiSpec(origin: string) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'MXIK Audit API',
      version: '1.0.0',
      description: 'Check product names against the MXIK classifier and audit whole catalogues. Authenticate with "Authorization: Bearer <key>"; keys are created in Settings.',
    },
    servers: [{ url: origin }],
    security: bearer,
    paths: {
      '/api/v1/check': {
        post: {
          summary: 'Check one or several products',
          requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [{ $ref: '#/components/schemas/CheckItem' }, { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { $ref: '#/components/schemas/CheckItem' } } } }] } } } },
          responses: {
            200: { description: 'Findings per product', content: { 'application/json': { schema: { type: 'object', properties: { results: { type: 'array', items: { $ref: '#/components/schemas/CheckResult' } } } } } } },
            400: error, 401: error, 402: error, 429: error,
          },
        },
      },
      '/api/v1/catalogs': {
        post: {
          summary: 'Upload a spreadsheet and audit it in the background',
          requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, clientId: { type: 'string' } } } } } },
          responses: {
            202: { description: 'Accepted; poll the report', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' }, rows: { type: 'integer' }, clientId: { type: 'string' } } } } } },
            400: error, 401: error, 402: error, 413: error, 422: error, 429: error,
          },
        },
      },
      '/api/v1/catalogs/{id}/report': {
        get: {
          summary: 'Status and findings of a catalogue',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000, default: 200 } },
            { name: 'cursor', in: 'query', description: 'nextCursor of the previous page', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Report; findings appear once status is "ready"', content: { 'application/json': { schema: { $ref: '#/components/schemas/Report' } } } }, 401: error, 404: error, 429: error },
        },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } },
        CheckItem: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, barcode: { type: 'string' }, unit: { type: 'string' }, mxik: { type: 'string', description: 'The code the product currently has' } } },
        CheckResult: {
          type: 'object',
          properties: {
            name: { type: 'string' }, markingRequired: { type: 'boolean' },
            findings: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT', 'NOT_PURCHASED', 'PRIVILEGE_CODE', 'PRIVILEGE_OPPORTUNITY'] }, severity: { type: 'string', enum: ['high', 'medium', 'info'] }, suggestedMxik: { type: 'string', nullable: true }, confidence: { type: 'number', nullable: true }, reason: { type: 'string' }, alternatives: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, name: { type: 'string' }, confidence: { type: 'number' } } } } } } },
          },
        },
        Report: {
          type: 'object',
          properties: {
            id: { type: 'string' }, status: { type: 'string', enum: ['uploaded', 'analyzing', 'ready', 'failed'] }, rows: { type: 'integer' },
            progress: { type: 'object', properties: { done: { type: 'integer' }, total: { type: 'integer' } } },
            summary: { type: 'object', additionalProperties: { type: 'integer' } },
            findings: { type: 'array', items: { type: 'object' } },
            nextCursor: { type: 'string', nullable: true },
          },
        },
      },
    },
  };
}
