// One decorator per route from the @tasnivo/contracts registry: the HTTP method and path, the
// status, the guards the endpoint's `auth`/`role`/`noDemo` ask for, and the Swagger entry built
// from the same zod schemas the api-client uses. Controllers then only parse and call the domain.
import {
  applyDecorators, Delete, Get, HttpCode, Injectable, Patch, Post, Put, SetMetadata, UseGuards,
  type CanActivate, type ExecutionContext,
} from '@nestjs/common';
import {
  ApiBody, ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import { CSRF_HEADER, CSRF_VALUE, expressPath, SchemaConverter, type Endpoint } from '@tasnivo/contracts';
import { canWrite, isAdminRole } from '@tasnivo/domain/access';
import { isDemoOrg } from '@tasnivo/domain/demo';
import type { AnyZodObject, ZodTypeAny } from 'zod';
import { SessionGuard } from '../auth-core/session.guard';
import { ApiError } from './errors';
import type { ApiRequest } from './request';

export const CONTRACT_ENDPOINT = 'tasnivo:contract-endpoint';

type Json = Record<string, unknown>;

const errorSchema: Json = {
  type: 'object', required: ['error'],
  properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } } },
};

/**
 * The role and demo rules of a session endpoint, after SessionGuard: `writer` = admin or
 * accountant (canWrite), `admin` = org admin, `noDemo` = refused for a demo session or a demo org
 * (the old actions' `user.demo` / `isDemoOrg`). Refusals are 403 envelopes; the domain functions
 * behind the route still check access themselves.
 */
@Injectable()
export class ContractGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const endpoint = Reflect.getMetadata(CONTRACT_ENDPOINT, ctx.getHandler()) as Endpoint | undefined;
    if (!endpoint || endpoint.auth !== 'session') return true;
    const user = ctx.switchToHttp().getRequest<ApiRequest>().user;
    if (!user) throw new ApiError(401, 'unauthorized', 'Sign in to continue.');
    const role = endpoint.role ?? 'any';
    if (role === 'writer' && !canWrite(user)) throw new ApiError(403, 'forbidden', 'Your role cannot change data.');
    if (role === 'admin' && !isAdminRole(user)) throw new ApiError(403, 'forbidden', 'Only an administrator can do this.');
    // Not wired here: the platform-admin check lives with the admin module.
    if (role === 'platformAdmin') throw new ApiError(403, 'forbidden', 'Platform administrators only.');
    if (endpoint.noDemo && (user.demo || await isDemoOrg(user.orgId))) throw new ApiError(403, 'demo', 'Not available in the demo.');
    return true;
  }
}

const converter = new SchemaConverter();

/** A converted schema with every components.schemas reference inlined (Nest's document has none of them). */
function jsonSchema(schema: ZodTypeAny): Json {
  return inline(converter.convert(schema), new Set());
}

function inline(value: unknown, seen: Set<string>): Json {
  if (Array.isArray(value)) return value.map((v) => inline(v, seen)) as unknown as Json;
  if (!value || typeof value !== 'object') return value as Json;
  const obj = value as Json;
  const ref = obj['$ref'];
  if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
    const name = ref.slice('#/components/schemas/'.length);
    // A recursive schema stops at its second appearance.
    if (seen.has(name)) return { type: 'object', description: name };
    return inline(converter.schemas[name] ?? { type: 'object' }, new Set([...seen, name]));
  }
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, inline(v, seen)]));
}

function fieldsOf(schema: AnyZodObject): { name: string; required: boolean; schema: Json }[] {
  const object = jsonSchema(schema);
  const properties = (object['properties'] ?? {}) as Record<string, Json>;
  const required = new Set((object['required'] ?? []) as string[]);
  return Object.entries(properties).map(([name, s]) => ({ name, required: required.has(name), schema: s }));
}

const METHODS = { GET: Get, POST: Post, PUT: Put, PATCH: Patch, DELETE: Delete } as const;

/** The route path under the global `api` prefix: `/api/catalogs/{catalogId}` → `catalogs/:catalogId`. */
export const routePath = (endpoint: Pick<Endpoint, 'path'>): string => expressPath(endpoint.path).replace(/^\/api\/?/, '');

/**
 * Method, path, status, guards and Swagger of one registry endpoint. Use in a controller declared
 * with a bare `@Controller()`:
 *
 *   @ContractRoute(endpoints.workspace.decide)
 *   decide(@CurrentUser() user, @Param(new ZodValidationPipe(e.params)) p, @Body(new ZodValidationPipe(e.body)) body) { … }
 *
 * Session endpoints get SessionGuard + ContractGuard (role, noDemo). Other kinds of auth
 * (apiKey, cron, provider signatures, share tokens) add their own guard next to this decorator.
 */
export function ContractRoute(endpoint: Endpoint): MethodDecorator {
  const decorators: (MethodDecorator | ClassDecorator)[] = [
    SetMetadata(CONTRACT_ENDPOINT, endpoint),
    METHODS[endpoint.method](routePath(endpoint)),
    HttpCode(endpoint.responds === 'json' ? endpoint.status ?? 200 : 200),
    ApiTags(endpoint.module),
    ApiOperation({
      operationId: endpoint.operationId,
      summary: typeof endpoint.summary === 'string' ? endpoint.summary : endpoint.summary({ ratePerMinute: 60, maxCheckItems: 20 }),
      ...(endpoint.notes ? { description: endpoint.notes } : {}),
    }),
  ];
  if (endpoint.auth === 'session') {
    decorators.push(UseGuards(SessionGuard, ContractGuard), ApiCookieAuth('session'));
    decorators.push(ApiResponse({ status: 401, description: 'unauthorized', schema: errorSchema }));
    if ((endpoint.role ?? 'any') !== 'any' || endpoint.noDemo) {
      decorators.push(ApiResponse({ status: 403, description: `forbidden (role ${endpoint.role ?? 'any'})${endpoint.noDemo ? ', demo' : ''}`, schema: errorSchema }));
    }
  }
  if (endpoint.csrf) decorators.push(ApiHeader({ name: CSRF_HEADER, required: true, description: `Must be "${CSRF_VALUE}" (CSRF check).` }));
  for (const p of endpoint.params ? fieldsOf(endpoint.params) : []) decorators.push(ApiParam({ name: p.name, required: true, schema: p.schema }));
  for (const q of endpoint.query ? fieldsOf(endpoint.query) : []) decorators.push(ApiQuery({ name: q.name, required: q.required, schema: q.schema }));
  if (endpoint.body) decorators.push(ApiBody({ schema: jsonSchema(endpoint.body) }));
  if (endpoint.params || endpoint.query || endpoint.body) decorators.push(ApiResponse({ status: 400, description: 'invalid_request', schema: errorSchema }));
  if (endpoint.responds === 'json') {
    decorators.push(ApiResponse({ status: endpoint.status ?? 200, schema: jsonSchema(endpoint.response) }));
  }
  return applyDecorators(...decorators);
}
