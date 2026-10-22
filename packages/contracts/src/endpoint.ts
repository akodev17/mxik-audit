// What one endpoint is: method, path, who may call it, the zod schemas of its request and
// response, and which server action or route handler of the Next app it replaces. The Nest
// controllers (W2) and @tasnivo/api-client both read these definitions, so the two sides cannot
// drift apart. Pure data plus zod; no framework imports.
import type { AnyZodObject, ZodTypeAny } from 'zod';

/** How a request proves who it is. */
export const AUTH_KINDS = ['session', 'apiKey', 'cron', 'public', 'providerSignature', 'shareToken'] as const;
export type AuthKind = (typeof AUTH_KINDS)[number];

/**
 * For session endpoints, the guard the old action applied: any signed-in user (`currentUser`),
 * someone who may change data (`writer`), an org admin (`admin`) or a platform admin.
 */
export type Role = 'any' | 'writer' | 'admin' | 'platformAdmin';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const MODULES = [
  'auth', 'account', 'clients', 'catalogs', 'workspace', 'dictionary', 'imports', 'team', 'reminders',
  'notifications', 'billing', 'demo', 'publicApi', 'admin', 'share', 'cron', 'health',
] as const;
export type ModuleName = (typeof MODULES)[number];

/** A file part of a multipart request. The server enforces the cap and the extensions; the client only sends. */
export type FileField = {
  required: boolean;
  maxBytes: number;
  /** Lower-case, with the dot. Checked by file name, as the old actions did. */
  extensions?: readonly string[];
  description?: string;
};

/** A multipart/form-data request: text fields (strings, as FormData carries them) and file parts. */
export type Multipart = { fields: AnyZodObject; files: Readonly<Record<string, FileField>> };

/** The public API v1 conventions an endpoint follows (packages/domain/src/api/contract.ts). */
export type PublicApiMeta = {
  success: 200 | 202;
  idempotent: boolean;
  paginated: boolean;
  errors: readonly string[];
  successDescription: string;
  /** Name of the success schema in components.schemas. */
  successSchema: string;
};

/** Values the OpenAPI text depends on (packages/domain/src/api/limits.ts apiConfig()). */
export type DocConfig = { ratePerMinute: number; maxCheckItems: number };

type Common = {
  method: HttpMethod;
  /** OpenAPI style: `/api/catalogs/{catalogId}`. `expressPath()` gives the `:catalogId` form for Nest. */
  path: string;
  auth: AuthKind;
  /** Session endpoints only. */
  role?: Role;
  /** Refused for a demo org, as the old action did (`isDemoOrg`). */
  noDemo?: boolean;
  summary: string | ((config: DocConfig) => string);
  /** Path parameters; every `{name}` in the path has a key here. */
  params?: AnyZodObject;
  /** Query string; values arrive as strings. */
  query?: AnyZodObject;
  /** JSON body (or form fields for a form-urlencoded provider callback). */
  body?: ZodTypeAny;
  bodyType?: 'json' | 'form-urlencoded';
  multipart?: Multipart;
  /**
   * What this endpoint takes over in apps/web: `action:<file>#<export>` for a server action in
   * src/app/actions, `route:<METHOD> <url>` for a route handler, `page:<route>` for data a server
   * page reads today. README.md lists them as the W2/W3 checklist.
   */
  replaces: readonly string[];
  /** Set when the shape is a first draft (page data assembled in a server component today); W2 confirms it. */
  provisional?: string;
  /** Left out of the OpenAPI document (the document itself). */
  documented?: boolean;
  publicApi?: PublicApiMeta;
  /** Other notes for the implementer. */
  notes?: string;
};

/** A JSON answer. HTTP errors (401, 403, 404, 413, 429, 500) use the error envelope instead. */
export type JsonResponds = { responds: 'json'; response: ZodTypeAny; /** Default 200. */ status?: number; /** Also answered with the same body, e.g. 503 from health. */ alsoStatus?: readonly number[] };
/** A download (Content-Disposition kept from the old route). */
export type FileResponds = { responds: 'file'; file: { contentTypes: readonly string[]; disposition: 'attachment' | 'inline' | 'either' } };
/** A browser navigation that ends in a redirect (verification link, Telegram widget callback). */
export type RedirectResponds = { responds: 'redirect' };
/** Passed through to a third-party library as-is (Telegram webhook). */
export type RawResponds = { responds: 'raw'; contentType: string };

export type EndpointDef = Common & (JsonResponds | FileResponds | RedirectResponds | RawResponds);

export type Endpoint<D extends EndpointDef = EndpointDef> = D & {
  operationId: string;
  module: ModuleName;
  /** Mutations from the browser must send `X-Requested-With: tasnivo` (plan §3.1). */
  csrf: boolean;
};

export const CSRF_HEADER = 'X-Requested-With';
export const CSRF_VALUE = 'tasnivo';

/** Session and public endpoints are called by the browser with cookies; those are the ones CSRF can reach. */
export function needsCsrf(def: Pick<EndpointDef, 'method' | 'auth'>): boolean {
  return def.method !== 'GET' && (def.auth === 'session' || def.auth === 'public');
}

/** Identity helper that keeps the literal schema types for inference. */
export function endpoint<const D extends EndpointDef>(def: D): D {
  return def;
}

export type ModuleOf<N extends ModuleName, M extends Record<string, EndpointDef>> = { readonly [K in keyof M]: Endpoint<M[K]> & { module: N } };

/**
 * Names the endpoints of one module: operation id `<module>.<key>` unless the definition carries
 * its own (the public API keeps `check`, `listCatalogs`… for byte-for-byte compatibility).
 */
export function defineModule<N extends ModuleName, M extends Record<string, EndpointDef>>(
  module: N, defs: M, operationIds: Partial<Record<keyof M, string>> = {},
): ModuleOf<N, M> {
  const out: Record<string, Endpoint> = {};
  for (const [key, def] of Object.entries(defs)) {
    out[key] = { ...def, operationId: operationIds[key] ?? `${module}.${key}`, module, csrf: needsCsrf(def) };
  }
  return out as ModuleOf<N, M>;
}

/** `/api/catalogs/{catalogId}` → `/api/catalogs/:catalogId` (Express and Nest route syntax). */
export function expressPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, ':$1');
}

/** Names of the `{params}` in a path, in order. */
export function pathParams(path: string): string[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '');
}
