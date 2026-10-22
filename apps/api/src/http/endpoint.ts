// `@Endpoint(endpoints.<module>.<operation>)`: one decorator that turns a registry entry of
// @tasnivo/contracts into the Nest route — method and path, status, guards for its auth and role,
// and the Swagger operation (parameters, body, answers) converted from the same zod schemas. The
// controller then only parses its input and calls the domain.
import {
  applyDecorators, Delete, Get, HttpCode, Patch, Post, Put, SetMetadata, StreamableFile, UseGuards, UseInterceptors,
  type CallHandler, type ExecutionContext, type NestInterceptor,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiExtension, ApiHeader, ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiResponse, type SchemaObject } from '@nestjs/swagger';
import { map, type Observable } from 'rxjs';
import type { ZodTypeAny } from 'zod';
import { CSRF_HEADER, CSRF_VALUE, ErrorEnvelope, expressPath, pathParams, SchemaConverter, type Endpoint as EndpointDef } from '@tasnivo/contracts';
import { ApiKeyGuard } from '../auth-core/api-key.guard';
import { CronGuard } from '../auth-core/cron.guard';
import { ROLE_KEY, RoleGuard } from '../auth-core/role.guard';
import { SessionGuard } from '../auth-core/session.guard';
import { SkipCsrf } from './decorators';

/** app.ts sets the global prefix "api"; registry paths carry it. */
const GLOBAL_PREFIX_PATH = '/api/';

const ROUTES = { GET: Get, POST: Post, PUT: Put, PATCH: Patch, DELETE: Delete } as const;

/** The registry path as a Nest route under the global `/api` prefix: `/api/catalogs/{id}` → `catalogs/:id`. */
export function routePath(path: string): string {
  const express = expressPath(path);
  if (!express.startsWith(GLOBAL_PREFIX_PATH)) throw new Error(`${path}: every first-party path starts with ${GLOBAL_PREFIX_PATH}`);
  return express.slice(GLOBAL_PREFIX_PATH.length);
}

/**
 * zod → an inline OpenAPI schema. The contracts' converter names shared schemas in
 * components.schemas; Nest's document has its own components, so references are inlined.
 */
export function swaggerSchema(schema: ZodTypeAny): SchemaObject {
  const conv = new SchemaConverter();
  const root = conv.convert(schema);
  const inline = (value: unknown, seen: readonly string[]): unknown => {
    if (Array.isArray(value)) return value.map((v) => inline(v, seen));
    if (value === null || typeof value !== 'object') return value;
    const ref = (value as { $ref?: unknown }).$ref;
    if (typeof ref === 'string') {
      const name = ref.split('/').pop() ?? '';
      // A recursive schema would never end; it stays an untyped object below its first level.
      return seen.includes(name) ? { type: 'object' } : inline(conv.schemas[name], [...seen, name]);
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inline(v, seen)]));
  };
  return inline(root, []) as SchemaObject;
}

const errorSchema = swaggerSchema(ErrorEnvelope);

/** Field schemas of a zod object, for one ApiParam/ApiQuery each. */
function fields(schema: ZodTypeAny | undefined): [string, ZodTypeAny][] {
  const shape = (schema as { shape?: Record<string, ZodTypeAny> } | undefined)?.shape;
  return shape ? Object.entries(shape) : [];
}

function guards(e: EndpointDef): (ClassDecorator | MethodDecorator)[] {
  switch (e.auth) {
    case 'session':
      return [UseGuards(SessionGuard, RoleGuard), SetMetadata(ROLE_KEY, e.role ?? 'any'), ApiCookieAuth('session')];
    case 'apiKey':
      return [UseGuards(ApiKeyGuard)];
    case 'cron':
      return [UseGuards(CronGuard), SkipCsrf()];
    // public and shareToken: no session needed (a share token is checked by the domain, resolveShare).
    default:
      return [];
  }
}

function swagger(e: EndpointDef): (ClassDecorator | MethodDecorator)[] {
  const summary = typeof e.summary === 'function' ? e.summary({ ratePerMinute: 60, maxCheckItems: 20 }) : e.summary;
  const out: (ClassDecorator | MethodDecorator)[] = [
    ApiOperation({ operationId: e.operationId, summary, ...(e.notes ? { description: e.notes } : {}) }),
    ApiExtension('x-auth', e.auth),
    ApiExtension('x-replaces', [...e.replaces]),
  ];
  if (e.role) out.push(ApiExtension('x-role', e.role));
  if (e.noDemo) out.push(ApiExtension('x-no-demo', true));
  if (e.provisional) out.push(ApiExtension('x-provisional', e.provisional));
  const params = new Map(fields(e.params));
  for (const name of pathParams(e.path)) {
    const field = params.get(name);
    out.push(ApiParam({ name, required: true, schema: field ? swaggerSchema(field) : { type: 'string' } }));
  }
  for (const [name, field] of fields(e.query)) out.push(ApiQuery({ name, required: !field.isOptional(), schema: swaggerSchema(field) }));
  if (e.csrf) out.push(ApiHeader({ name: CSRF_HEADER, required: true, description: `Must be "${CSRF_VALUE}" (CSRF check).`, schema: { type: 'string', enum: [CSRF_VALUE] } }));
  if (e.multipart) {
    out.push(ApiConsumes('multipart/form-data'), ApiBody({ schema: new SchemaConverter().multipart(e.multipart, true) as SchemaObject }));
  } else if (e.body) {
    out.push(ApiBody({ schema: swaggerSchema(e.body) }));
  }
  switch (e.responds) {
    case 'json':
      out.push(ApiResponse({ status: e.status ?? 200, description: 'OK', schema: swaggerSchema(e.response) }));
      break;
    case 'file':
      out.push(
        ApiProduces(...e.file.contentTypes),
        ApiResponse({ status: 200, description: `File (${e.file.disposition})`, content: Object.fromEntries(e.file.contentTypes.map((t) => [t, { schema: { type: 'string', format: 'binary' } }])) }),
      );
      break;
    default:
      break;
  }
  out.push(ApiResponse({ status: 'default', description: 'Error envelope: { error: { code, message } }.', schema: errorSchema }));
  return out;
}

/**
 * Express sends a scalar answer (null, true, 3) as text, and null as an empty body. The actions'
 * answers include those, so they leave as JSON like every other answer.
 */
export class JsonAnswerInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((value: unknown) => (value === null || typeof value !== 'object'
      ? new StreamableFile(Buffer.from(JSON.stringify(value ?? null)), { type: 'application/json; charset=utf-8' })
      : value)));
  }
}

/** The route, its status, its guards and its Swagger operation, all from the registry entry. */
export function Endpoint(e: EndpointDef): MethodDecorator {
  return applyDecorators(
    ROUTES[e.method](routePath(e.path)),
    HttpCode(e.responds === 'json' ? (e.status ?? 200) : 200),
    ...(e.responds === 'json' ? [UseInterceptors(JsonAnswerInterceptor)] : []),
    ...guards(e),
    ...swagger(e),
  );
}
