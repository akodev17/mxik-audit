// OpenAPI 3.0.3 from the registry. scope "public" is the /api/v1 document served at
// /api/v1/openapi.json, identical to packages/domain/src/api/openapi.ts (openapi.test.ts compares);
// scope "all" adds the first-party endpoints for /api/docs. The zod → schema conversion below
// covers the zod features the contracts use; meta.ts carries what zod cannot express.
import type { AnyZodObject, ZodTypeAny } from 'zod';
import { ErrorEnvelope } from './common';
import { CSRF_HEADER, CSRF_VALUE, pathParams, type AuthKind, type DocConfig, type Endpoint, type Multipart } from './endpoint';
import { metaOf } from './meta';
import { ERROR_STATUS, HEADERS, IDEMPOTENCY, V1Error, type ApiErrorCode } from './modules/public-api';
import { allEndpoints } from './registry';

type Json = Record<string, unknown>;

export const DEFAULT_DOC_CONFIG: DocConfig = { ratePerMinute: 60, maxCheckItems: 20 };

/** The session cookie (iron-session) first-party endpoints authenticate with. */
export const SESSION_COOKIE = 'mxik_audit_session';

// ── zod → OpenAPI 3.0 schema ───────────────────────────────────────────────────────────────

type Def = { typeName?: string; description?: string } & Record<string, unknown>;
type Check = { kind: string; value?: unknown; inclusive?: boolean; regex?: RegExp };

const defOf = (schema: ZodTypeAny): Def => schema._def as Def;

/** Adds keys to a schema; a $ref cannot have siblings in 3.0, so it is wrapped in allOf. */
function merge(base: Json, extra: Json): Json {
  if (Object.keys(extra).length === 0) return base;
  return '$ref' in base ? { allOf: [base], ...extra } : { ...base, ...extra };
}

export class SchemaConverter {
  /** components.schemas collected while converting. */
  readonly schemas: Record<string, Json> = {};

  constructor(readonly config: DocConfig = DEFAULT_DOC_CONFIG) {}

  convert(schema: ZodTypeAny): Json {
    const meta = metaOf(schema);
    if (meta?.ref) {
      if (!(meta.ref in this.schemas)) {
        this.schemas[meta.ref] = {}; // placeholder: a recursive reference finds the name taken
        this.schemas[meta.ref] = this.body(schema);
      }
      return { $ref: `#/components/schemas/${meta.ref}` };
    }
    return this.body(schema);
  }

  private body(schema: ZodTypeAny): Json {
    const meta = metaOf(schema);
    let out = meta?.schema ? { ...meta.schema } : this.shape(schema);
    const description = defOf(schema).description;
    if (description) out = merge(out, { description });
    if (meta?.extend) out = merge(out, typeof meta.extend === 'function' ? meta.extend(this.config) : meta.extend);
    return out;
  }

  private shape(schema: ZodTypeAny): Json {
    const def = defOf(schema);
    const inner = (key: string): ZodTypeAny => def[key] as ZodTypeAny;
    switch (def.typeName) {
      case 'ZodString': return this.string(def['checks'] as Check[]);
      case 'ZodNumber': return this.number(def['checks'] as Check[]);
      case 'ZodBigInt': return { type: 'integer' };
      case 'ZodBoolean': return { type: 'boolean' };
      case 'ZodDate': return { type: 'string', format: 'date-time' };
      case 'ZodLiteral': return this.literal(def['value']);
      case 'ZodEnum': return { type: 'string', enum: [...(def['values'] as string[])] };
      case 'ZodNativeEnum': return { enum: Object.values(def['values'] as object) };
      case 'ZodNull': return { nullable: true };
      case 'ZodOptional': return this.convert(inner('innerType'));
      case 'ZodNullable': return merge(this.convert(inner('innerType')), { nullable: true });
      case 'ZodDefault': return merge(this.convert(inner('innerType')), { default: (def['defaultValue'] as () => unknown)() });
      case 'ZodCatch':
      case 'ZodReadonly': return this.convert(inner('innerType'));
      case 'ZodBranded': return this.convert(inner('type'));
      case 'ZodLazy': return this.convert((def['getter'] as () => ZodTypeAny)());
      // A transform or refinement: document what the client sends.
      case 'ZodEffects': return this.convert(inner('schema'));
      case 'ZodPipeline': return this.convert(inner('in'));
      case 'ZodArray': return this.array(def);
      case 'ZodObject': return this.object(schema as AnyZodObject);
      case 'ZodRecord':
      case 'ZodMap': return { type: 'object', additionalProperties: this.convert(inner('valueType')) };
      case 'ZodUnion':
      case 'ZodDiscriminatedUnion': return this.union([...(def['options'] as ZodTypeAny[] | Map<unknown, ZodTypeAny>).values()]);
      case 'ZodIntersection': return { allOf: [this.convert(inner('left')), this.convert(inner('right'))] };
      case 'ZodTuple': return this.tuple(def['items'] as ZodTypeAny[]);
      default: return {}; // ZodAny, ZodUnknown, ZodVoid, z.custom: anything
    }
  }

  private string(checks: Check[]): Json {
    const out: Json = { type: 'string' };
    for (const c of checks) {
      if (c.kind === 'min') out['minLength'] = c.value;
      else if (c.kind === 'max') out['maxLength'] = c.value;
      else if (c.kind === 'length') { out['minLength'] = c.value; out['maxLength'] = c.value; }
      else if (c.kind === 'email') out['format'] = 'email';
      else if (c.kind === 'url') out['format'] = 'uri';
      else if (c.kind === 'uuid') out['format'] = 'uuid';
      else if (c.kind === 'datetime') out['format'] = 'date-time';
      else if (c.kind === 'date') out['format'] = 'date';
      else if (c.kind === 'regex' && c.regex) out['pattern'] = c.regex.source;
    }
    return out;
  }

  private number(checks: Check[]): Json {
    const out: Json = { type: checks.some((c) => c.kind === 'int') ? 'integer' : 'number' };
    for (const c of checks) {
      if (c.kind === 'min') { out['minimum'] = c.value; if (c.inclusive === false) out['exclusiveMinimum'] = true; }
      else if (c.kind === 'max') { out['maximum'] = c.value; if (c.inclusive === false) out['exclusiveMaximum'] = true; }
    }
    return out;
  }

  private literal(value: unknown): Json {
    if (value === null) return { nullable: true };
    const type = typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value;
    return { type, enum: [value] };
  }

  private array(def: Def): Json {
    const out: Json = { type: 'array', items: this.convert(def['type'] as ZodTypeAny) };
    const min = (def['minLength'] as { value: number } | null)?.value;
    const max = (def['maxLength'] as { value: number } | null)?.value;
    const exact = (def['exactLength'] as { value: number } | null)?.value;
    if (min !== undefined) out['minItems'] = min;
    if (max !== undefined) out['maxItems'] = max;
    if (exact !== undefined) { out['minItems'] = exact; out['maxItems'] = exact; }
    return out;
  }

  object(schema: AnyZodObject): Json {
    const properties: Record<string, Json> = {};
    const required: string[] = [];
    for (const [key, field] of Object.entries(schema.shape as Record<string, ZodTypeAny>)) {
      properties[key] = this.convert(field);
      if (!field.isOptional()) required.push(key);
    }
    const out: Json = { type: 'object', ...(required.length > 0 ? { required } : {}), properties };
    const def = defOf(schema);
    const catchall = def['catchall'] as ZodTypeAny | undefined;
    if (catchall && defOf(catchall).typeName !== 'ZodNever') out['additionalProperties'] = this.convert(catchall);
    else if (def['unknownKeys'] === 'passthrough') out['additionalProperties'] = true;
    return out;
  }

  private union(options: ZodTypeAny[]): Json {
    const nullable = options.some((o) => defOf(o).typeName === 'ZodNull');
    const rest = options.filter((o) => defOf(o).typeName !== 'ZodNull');
    const out: Json = rest.length === 1 && rest[0] ? this.convert(rest[0]) : { oneOf: rest.map((o) => this.convert(o)) };
    return nullable ? merge(out, { nullable: true }) : out;
  }

  private tuple(items: ZodTypeAny[]): Json {
    const converted = items.map((i) => this.convert(i));
    const same = converted.every((c) => JSON.stringify(c) === JSON.stringify(converted[0]));
    return { type: 'array', items: same && converted[0] ? converted[0] : { oneOf: converted }, minItems: items.length, maxItems: items.length };
  }

  /** A multipart body: file parts as binary strings, then the text fields. `limits` adds x-max-bytes and x-extensions. */
  multipart(multipart: Multipart, limits = false): Json {
    const properties: Record<string, Json> = {};
    const required: string[] = [];
    for (const [name, file] of Object.entries(multipart.files)) {
      properties[name] = {
        type: 'string', format: 'binary',
        ...(file.description ? { description: file.description } : {}),
        ...(limits ? { 'x-max-bytes': file.maxBytes, ...(file.extensions ? { 'x-extensions': [...file.extensions] } : {}) } : {}),
      };
      if (file.required) required.push(name);
    }
    const fields = this.object(multipart.fields);
    Object.assign(properties, fields['properties']);
    required.push(...((fields['required'] as string[] | undefined) ?? []));
    return { type: 'object', ...(required.length > 0 ? { required } : {}), properties };
  }
}

// ── Operations ─────────────────────────────────────────────────────────────────────────────

const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });

function parameters(e: Endpoint, conv: SchemaConverter): Json[] {
  const out: Json[] = [];
  if (e.publicApi?.idempotent) out.push({ $ref: '#/components/parameters/IdempotencyKey' });
  const param = (name: string, where: 'path' | 'query', field: ZodTypeAny | undefined, required: boolean): Json => {
    const schema = field ? conv.convert(field) : { type: 'string' };
    const { description, ...rest } = schema;
    return { name, in: where, ...(required ? { required: true } : {}), ...(description ? { description } : {}), schema: rest };
  };
  const pathShape = (e.params?.shape ?? {}) as Record<string, ZodTypeAny>;
  for (const name of pathParams(e.path)) out.push(param(name, 'path', pathShape[name], true));
  for (const [name, field] of Object.entries((e.query?.shape ?? {}) as Record<string, ZodTypeAny>)) out.push(param(name, 'query', field, !field.isOptional()));
  if (e.csrf) out.push({ name: CSRF_HEADER, in: 'header', required: true, description: 'CSRF guard for browser mutations (plan §3.1).', schema: { type: 'string', enum: [CSRF_VALUE] } });
  return out;
}

function requestBody(e: Endpoint, conv: SchemaConverter): Json | undefined {
  // The public API's document never listed the caps; keep it as it was.
  if (e.multipart) return { required: true, content: { 'multipart/form-data': { schema: conv.multipart(e.multipart, !e.publicApi) } } };
  if (!e.body) return undefined;
  const type = e.bodyType === 'form-urlencoded' ? 'application/x-www-form-urlencoded' : 'application/json';
  return { required: true, content: { [type]: { schema: conv.convert(e.body) } } };
}

const rateHeaders = {
  [HEADERS.limit]: { $ref: '#/components/headers/RateLimitLimit' },
  [HEADERS.remaining]: { $ref: '#/components/headers/RateLimitRemaining' },
};

/** The public API's responses, exactly as packages/domain/src/api/openapi.ts writes them. */
function publicResponses(e: Endpoint, conv: SchemaConverter): Json {
  const meta = e.publicApi;
  if (!meta || e.responds !== 'json') throw new Error(`${e.operationId}: public API endpoint without publicApi meta`);
  const headers = meta.idempotent ? { ...rateHeaders, [HEADERS.replayed]: { $ref: '#/components/headers/IdempotentReplayed' } } : rateHeaders;
  const byStatus = new Map<number, ApiErrorCode[]>();
  for (const code of meta.errors as ApiErrorCode[]) byStatus.set(ERROR_STATUS[code], [...(byStatus.get(ERROR_STATUS[code]) ?? []), code]);
  const errorRef = conv.convert(V1Error);
  return {
    [String(meta.success)]: { description: meta.successDescription, headers, content: { 'application/json': { schema: conv.convert(e.response) } } },
    ...Object.fromEntries([...byStatus].map(([status, codes]) => [String(status), {
      description: `Error: ${codes.join(', ')}.`,
      'x-error-codes': codes,
      // Without a valid key there is no key to count requests against.
      ...(status === ERROR_STATUS.unauthorized ? {} : { headers: status === ERROR_STATUS.rate_limited ? { ...rateHeaders, [HEADERS.retryAfter]: { $ref: '#/components/headers/RetryAfter' } } : rateHeaders }),
      content: { 'application/json': { schema: errorRef } },
    }])),
  };
}

function firstPartyResponses(e: Endpoint, conv: SchemaConverter): Json {
  const error = { description: 'Error envelope: { error: { code, message } }.', content: { 'application/json': { schema: ref('ApiError') } } };
  switch (e.responds) {
    case 'json': {
      const ok = { description: 'OK', content: { 'application/json': { schema: conv.convert(e.response) } } };
      return { [String(e.status ?? 200)]: ok, ...Object.fromEntries((e.alsoStatus ?? []).map((s) => [String(s), { ...ok, description: 'Same body' }])), default: error };
    }
    case 'file':
      return { 200: { description: `File (${e.file.disposition})`, content: Object.fromEntries(e.file.contentTypes.map((t) => [t, { schema: { type: 'string', format: 'binary' } }])) }, default: error };
    case 'redirect':
      return { 302: { description: 'Redirect to the next page' } };
    case 'raw':
      return { 200: { description: `Passed through (${e.contentType})` } };
  }
}

const SECURITY: Record<AuthKind, Json[] | undefined> = {
  apiKey: undefined, // the document's global bearerAuth
  session: [{ cookieAuth: [] }],
  cron: [{ cronAuth: [] }],
  public: [],
  providerSignature: [],
  shareToken: [],
};

function operation(e: Endpoint, conv: SchemaConverter): Json {
  const summary = typeof e.summary === 'function' ? e.summary(conv.config) : e.summary;
  const params = parameters(e, conv);
  const body = requestBody(e, conv);
  if (e.publicApi) {
    return { operationId: e.operationId, summary, parameters: params, ...(body ? { requestBody: body } : {}), responses: publicResponses(e, conv) };
  }
  const security = SECURITY[e.auth];
  return {
    operationId: e.operationId,
    summary,
    tags: [e.module],
    ...(security ? { security } : {}),
    ...(params.length > 0 ? { parameters: params } : {}),
    ...(body ? { requestBody: body } : {}),
    responses: firstPartyResponses(e, conv),
    'x-auth': e.auth,
    ...(e.role ? { 'x-role': e.role } : {}),
    ...(e.noDemo ? { 'x-no-demo': true } : {}),
    ...(e.provisional ? { 'x-provisional': e.provisional } : {}),
    'x-replaces': [...e.replaces],
  };
}

export type BuildOptions = {
  /** servers[0].url. */
  origin: string;
  /** "public": /api/v1 only, as served today. "all": every documented endpoint. Default "all". */
  scope?: 'public' | 'all';
  config?: DocConfig;
};

export function buildOpenApi({ origin, scope = 'all', config = DEFAULT_DOC_CONFIG }: BuildOptions) {
  const conv = new SchemaConverter(config);
  const chosen = allEndpoints().filter((e) => e.documented !== false && (scope === 'all' || e.auth === 'apiKey'));
  // Public endpoints first, so components.schemas lists the v1 schemas in their usual order.
  chosen.sort((a, b) => Number(b.auth === 'apiKey') - Number(a.auth === 'apiKey'));
  const paths: Record<string, Record<string, Json>> = {};
  for (const e of chosen) {
    (paths[e.path] ??= {})[e.method.toLowerCase()] = operation(e, conv);
  }
  if (scope === 'all') conv.schemas['ApiError'] = conv.object(ErrorEnvelope);

  return {
    openapi: '3.0.3',
    info: {
      title: 'Tasnivo API',
      version: '1.1.0',
      description: [
        'Check product names against the MXIK classifier and audit whole catalogues.',
        'Authenticate with "Authorization: Bearer <key>"; an administrator creates keys in Settings → Integrations.',
        `Each key may send ${config.ratePerMinute} requests per minute; every response to a valid key carries ${HEADERS.limit} and ${HEADERS.remaining}.`,
        'Suggestions are not decisions: a code changes only when a person accepts it in the app.',
      ].join(' '),
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        ...(scope === 'all' ? {
          cookieAuth: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
          cronAuth: { type: 'http', scheme: 'bearer', description: 'CRON_SECRET' },
        } : {}),
      },
      parameters: {
        IdempotencyKey: {
          name: HEADERS.idempotencyKey, in: 'header', required: false,
          description: `1 to ${IDEMPOTENCY.maxLength} visible ASCII characters. Repeating a key with the same API key within ${IDEMPOTENCY.ttlHours} hours returns the first successful response (with ${HEADERS.replayed}: true) instead of running again. Failed requests are not stored. The same key with a different request answers 422 idempotency_key_reused; while the first request still runs, 409 idempotency_in_progress.`,
          schema: { type: 'string', minLength: 1, maxLength: IDEMPOTENCY.maxLength },
        },
      },
      headers: {
        RateLimitLimit: { description: 'Requests this key may send per minute.', schema: { type: 'integer' } },
        RateLimitRemaining: { description: 'Requests left in the current minute.', schema: { type: 'integer' } },
        RetryAfter: { description: 'Seconds to wait before the next request.', schema: { type: 'integer' } },
        IdempotentReplayed: { description: '"true" when this is the stored response of an earlier request with the same Idempotency-Key.', schema: { type: 'string' } },
      },
      schemas: conv.schemas,
    },
  };
}
