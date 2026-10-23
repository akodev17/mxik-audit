// One decorator per handler from its @tasnivo/contracts registry entry: the HTTP method and path,
// the status, the guards the entry's `auth`/`role`/`noDemo` call for, the CSRF exemption of
// non-browser callers, and the Swagger documentation generated from the entry's zod schemas
// (the same SchemaConverter that builds the contracts' OpenAPI document).
//
//   @ApiTags('team')            // on the class: without it Swagger tags by the controller's name
//   @Controller()
//   export class TeamController {
//     @Route(endpoints.team.removeMember)
//     remove(@CurrentUser() user, @Param(new ZodValidationPipe(endpoints.team.removeMember.params)) p) { … }
//   }
import { applyDecorators, Delete, Get, HttpCode, Patch, Post, Put, SetMetadata, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  ApiBody, ApiConsumes, ApiCookieAuth, ApiDefaultResponse, ApiExtension, ApiHeader, ApiOperation, ApiParam,
  ApiProduces, ApiQuery, ApiResponse, type ApiResponseOptions,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';
import type { ZodTypeAny } from 'zod';
import { CSRF_HEADER, CSRF_VALUE, DEFAULT_DOC_CONFIG, ErrorEnvelope, expressPath, pathParams, SchemaConverter, type Endpoint, type Multipart } from '@tasnivo/contracts';
import { AccessGuard, ENDPOINT } from '../auth-core/access.guard';
import { SessionGuard } from '../auth-core/session.guard';
import { SkipCsrf } from './decorators';
import { JsonAnswerInterceptor } from './json-answer.interceptor';

type Json = Record<string, unknown>;

const METHODS = { GET: Get, POST: Post, PUT: Put, PATCH: Patch, DELETE: Delete } as const;

/** Replaces `#/components/schemas/X` references with the schema itself: Nest's document does not carry the contracts' components. */
function inline(value: unknown, schemas: Record<string, Json>, seen: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map((v) => inline(v, schemas, seen));
  if (!value || typeof value !== 'object') return value;
  const ref = (value as Json)['$ref'];
  if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
    const name = ref.slice('#/components/schemas/'.length);
    // A recursive schema stops at its second visit.
    return seen.includes(name) ? { type: 'object', description: name } : inline(schemas[name] ?? {}, schemas, [...seen, name]);
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inline(v, schemas, seen)]));
}

/** OpenAPI schemas of one endpoint, with every reference inlined. */
function converter() {
  const conv = new SchemaConverter();
  return {
    schema: (zod: ZodTypeAny): SchemaObject => inline(conv.convert(zod), conv.schemas) as SchemaObject,
    multipart: (multipart: Multipart): SchemaObject => inline(conv.multipart(multipart, true), conv.schemas) as SchemaObject,
  };
}

function docs(e: Endpoint): MethodDecorator[] {
  const conv = converter();
  const summary = typeof e.summary === 'function' ? e.summary(DEFAULT_DOC_CONFIG) : e.summary;
  const out: MethodDecorator[] = [
    ApiOperation({ operationId: e.operationId, summary, ...(e.notes ? { description: e.notes } : {}) }),
    ApiExtension('x-auth', e.auth),
    ApiExtension('x-replaces', [...e.replaces]),
  ];
  if (e.role) out.push(ApiExtension('x-role', e.role));
  if (e.noDemo) out.push(ApiExtension('x-no-demo', true));
  if (e.allowUnverified) out.push(ApiExtension('x-allow-unverified', true));
  if (e.provisional) out.push(ApiExtension('x-provisional', e.provisional));
  if (e.auth === 'session') out.push(ApiCookieAuth('session'));
  if (e.csrf) out.push(ApiHeader({ name: CSRF_HEADER, required: true, description: `Must be "${CSRF_VALUE}" (CSRF check).`, schema: { type: 'string', enum: [CSRF_VALUE] } }));

  const params = (e.params?.shape ?? {}) as Record<string, ZodTypeAny>;
  for (const name of pathParams(e.path)) out.push(ApiParam({ name, required: true, schema: params[name] ? conv.schema(params[name]) : { type: 'string' } }));
  for (const [name, field] of Object.entries((e.query?.shape ?? {}) as Record<string, ZodTypeAny>)) {
    out.push(ApiQuery({ name, required: !field.isOptional(), schema: conv.schema(field) }));
  }
  if (e.multipart) out.push(ApiConsumes('multipart/form-data'), ApiBody({ schema: conv.multipart(e.multipart) }));
  else if (e.body) out.push(ApiBody({ schema: conv.schema(e.body) }));

  const error: ApiResponseOptions = { description: 'Error envelope: { error: { code, message } }.', schema: conv.schema(ErrorEnvelope) };
  switch (e.responds) {
    case 'json':
      out.push(ApiResponse({ status: e.status ?? 200, description: 'OK', schema: conv.schema(e.response) }), ApiDefaultResponse(error));
      break;
    case 'file':
      out.push(ApiProduces(...e.file.contentTypes), ApiResponse({ status: 200, description: `File (${e.file.disposition})`, schema: { type: 'string', format: 'binary' } }), ApiDefaultResponse(error));
      break;
    case 'redirect':
      out.push(ApiResponse({ status: 307, description: 'Redirect (relative Location) to the next page' }));
      break;
    case 'raw':
      out.push(ApiResponse({ status: 200, description: `Passed through (${e.contentType})` }));
      break;
  }
  return out;
}

export type RouteOptions = {
  /**
   * 'manual': a session endpoint whose handler reads the session itself instead of SessionGuard
   * (a closed org's page, a browser callback that redirects to sign-in instead of answering 401).
   */
  session?: 'guard' | 'manual';
};

/** Method, path (under the global /api prefix), status, guards, CSRF exemption and Swagger docs of a registry entry. */
export function Route(e: Endpoint, options: RouteOptions = {}): MethodDecorator {
  const path = expressPath(e.path).replace(/^\/api(?=\/|$)/, '') || '/';
  const decorators: MethodDecorator[] = [METHODS[e.method](path), SetMetadata(ENDPOINT, e), ...docs(e)];
  if (e.responds === 'json') decorators.push(HttpCode(e.status ?? 200), UseInterceptors(JsonAnswerInterceptor));
  if (e.auth === 'session' && options.session !== 'manual') decorators.push(UseGuards(SessionGuard, AccessGuard));
  // Non-browser callers (provider callbacks, cron, API keys) carry no session cookie to protect.
  if (!e.csrf && e.method !== 'GET') decorators.push(SkipCsrf());
  return applyDecorators(...decorators);
}
