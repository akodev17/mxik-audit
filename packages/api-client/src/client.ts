// A fetch wrapper built from the contracts registry: one method per endpoint,
// `api.catalogs.previewUpload(formData)`, typed by the endpoint's zod schemas. No React here;
// apps/web adds React Query on top (W3).
import { CSRF_HEADER, CSRF_VALUE, endpoints, pathParams, type Endpoint, type EndpointDef, type Endpoints } from '@tasnivo/contracts';
import type { z } from 'zod';
import { ApiError, errorFrom } from './errors';

type HeaderSource = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

export type ClientOptions = {
  /** Origin (and prefix) of the API; '' (default) for same-origin requests from the browser. */
  baseUrl?: string;
  /** Default 'include', so a web app on another origin in development still sends the session cookie. */
  credentials?: RequestCredentials;
  /** Extra headers on every request, or a getter evaluated per request. */
  headers?: HeaderSource;
  /** Check requests and answers against the contract. Default: on unless NODE_ENV is "production". */
  validate?: boolean;
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
};

/** Per call: an abort signal, extra headers, or any other fetch option. */
export type CallInit = Omit<RequestInit, 'body' | 'method'>;

export type DownloadedFile = { blob: Blob; filename: string | null; contentType: string | null };
export type RedirectAnswer = { status: number; location: string | null };

// ── Types derived from the definitions ─────────────────────────────────────────────────────

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type InputPart<S> = S extends z.ZodTypeAny ? (z.input<S> extends object ? z.input<S> : { body: z.input<S> }) : unknown;

/** Path params, query and JSON body as one object (keys never collide in the registry). */
export type InputOf<E extends EndpointDef> = Simplify<InputPart<E['params']> & InputPart<E['query']> & InputPart<E['body']>>;

type FilesOf<E extends EndpointDef> = E['multipart'] extends { files: infer F }
  ? { [K in keyof F as F[K] extends { required: true } ? K : never]: Blob } & { [K in keyof F as F[K] extends { required: true } ? never : K]?: Blob }
  : unknown;
type FieldsOf<E extends EndpointDef> = E['multipart'] extends { fields: infer S extends z.ZodTypeAny } ? z.input<S> : unknown;
/** A multipart request: a ready FormData, or its fields and files as an object. */
export type MultipartInput<E extends EndpointDef> = FormData | Simplify<FieldsOf<E> & FilesOf<E>>;

export type OutputOf<E extends EndpointDef> =
  E extends { responds: 'json'; response: infer R extends z.ZodTypeAny } ? z.output<R>
    : E extends { responds: 'file' } ? DownloadedFile
      : E extends { responds: 'redirect' } ? RedirectAnswer
        : Response;

/** The input may be left out when none of its keys is required. */
type Args<T> = Partial<T> extends T ? [input?: T, init?: CallInit] : [input: T, init?: CallInit];
type ParamsQuery<E extends EndpointDef> = Simplify<InputPart<E['params']> & InputPart<E['query']>>;

export type Method<E extends EndpointDef> = (E extends { multipart: object }
  ? (form: MultipartInput<E>, ...rest: Args<ParamsQuery<E>>) => Promise<OutputOf<E>>
  : (...args: Args<InputOf<E>>) => Promise<OutputOf<E>>) & {
  /** The definition this method calls. */
  readonly endpoint: Endpoint<E>;
  /** The URL with params and query filled in, for links and downloads (`<a href>`). */
  url(input?: Partial<InputOf<E>>): string;
};

type MethodFor<E> = E extends EndpointDef ? Method<E> : never;
export type ApiClient = { readonly [M in keyof Endpoints]: { readonly [K in keyof Endpoints[M]]: MethodFor<Endpoints[M][K]> } };

// ── Runtime ────────────────────────────────────────────────────────────────────────────────

function defaultValidate(): boolean {
  try {
    // Written out in full so Next inlines it in browser bundles.
    return process.env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

const keysOf = (schema: z.AnyZodObject | undefined): string[] => Object.keys((schema?.shape ?? {}) as Record<string, unknown>);

const OBJECT_TYPES = new Set(['ZodObject', 'ZodRecord', 'ZodUnion', 'ZodDiscriminatedUnion', 'ZodIntersection']);

/** Whether a body schema describes an object, so the call's remaining keys are the body (see InputPart). */
function objectBody(schema: z.ZodTypeAny): boolean {
  const def = schema._def as { typeName?: string; schema?: z.ZodTypeAny; innerType?: z.ZodTypeAny };
  if (def.typeName === 'ZodEffects' && def.schema) return objectBody(def.schema);
  if ((def.typeName === 'ZodOptional' || def.typeName === 'ZodNullable' || def.typeName === 'ZodDefault') && def.innerType) return objectBody(def.innerType);
  return OBJECT_TYPES.has(def.typeName ?? '');
}

function pick(input: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => k in input).map((k) => [k, input[k]]));
}

function check<S extends z.ZodTypeAny>(schema: S | undefined, value: unknown, e: Endpoint, part: string): void {
  if (!schema) return;
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(0, 'invalid_request', `${e.operationId}: ${part} does not match the contract: ${result.error.message}`, value);
}

/** A path, query or form value as text; objects as JSON rather than [object Object]. */
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v));

/** Fills `{param}`s and appends the query string. */
export function buildUrl(baseUrl: string, e: Pick<EndpointDef, 'path'>, params: Record<string, unknown>, query: Record<string, unknown>): string {
  const path = e.path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined || value === null || value === '') throw new ApiError(0, 'invalid_request', `${e.path}: missing path parameter "${name}"`);
    return encodeURIComponent(text(value));
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    for (const v of Array.isArray(value) ? (value as unknown[]) : [value]) search.append(key, text(v));
  }
  const qs = search.toString();
  return `${baseUrl.replace(/\/$/, '')}${path}${qs ? `?${qs}` : ''}`;
}

function toFormData(input: FormData | Record<string, unknown>): FormData {
  if (input instanceof FormData) return input;
  const form = new FormData();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v instanceof Blob) form.append(key, v, v instanceof File ? v.name : key);
      else form.append(key, text(v));
    }
  }
  return form;
}

/** filename*=UTF-8''… wins over filename="…" (export-filename.ts contentDisposition writes both). */
export function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(disposition);
  if (star?.[2]) {
    try { return decodeURIComponent(star[2].trim()); } catch { /* fall through to the plain name */ }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  return plain?.[1]?.trim() ?? null;
}

async function headersOf(source: HeaderSource | undefined): Promise<Headers> {
  if (!source) return new Headers();
  return new Headers(typeof source === 'function' ? await source() : source);
}

/** Calls one endpoint. The generated methods use this; it also serves endpoints built elsewhere. */
export async function call<E extends Endpoint>(e: E, input: unknown, init: CallInit = {}, options: ClientOptions = {}): Promise<OutputOf<E>> {
  const validate = options.validate ?? defaultValidate();
  const paramKeys = pathParams(e.path);
  const queryKeys = keysOf(e.query);

  let params: Record<string, unknown>;
  let query: Record<string, unknown>;
  let body: BodyInit | undefined;
  const headers = await headersOf(options.headers);
  for (const [k, v] of new Headers(init.headers)) headers.set(k, v);

  if (e.multipart) {
    const [form, extra] = input as [FormData | Record<string, unknown>, Record<string, unknown> | undefined];
    params = pick(extra ?? {}, paramKeys);
    query = pick(extra ?? {}, queryKeys);
    const data = toFormData(form);
    if (validate) {
      const files = e.multipart.files;
      const fields = Object.fromEntries([...data.entries()].filter(([k, v]) => typeof v === 'string' && !(k in files)));
      check(e.multipart.fields, fields, e, 'form fields');
      for (const [name, file] of Object.entries(e.multipart.files)) {
        if (file.required && !(data.get(name) instanceof Blob)) throw new ApiError(0, 'invalid_request', `${e.operationId}: file part "${name}" is required`);
      }
    }
    body = data;
  } else {
    const all = (input ?? {}) as Record<string, unknown>;
    params = pick(all, paramKeys);
    query = pick(all, queryKeys);
    if (e.body) {
      const rest = Object.fromEntries(Object.entries(all).filter(([k]) => !paramKeys.includes(k) && !queryKeys.includes(k)));
      // A body that is not an object (z.unknown(), a scalar) is passed as { body } (InputOf).
      const payload = objectBody(e.body) ? rest : rest['body'];
      if (validate) check(e.body, payload, e, 'body');
      if (e.bodyType === 'form-urlencoded') {
        body = new URLSearchParams(Object.entries(payload as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
      } else {
        headers.set('content-type', 'application/json');
        body = JSON.stringify(payload);
      }
    }
  }
  if (validate) {
    check(e.params, params, e, 'path parameters');
    check(e.query, query, e, 'query');
  }

  if (e.method !== 'GET') headers.set(CSRF_HEADER, CSRF_VALUE);
  if (e.responds === 'json' && !headers.has('accept')) headers.set('accept', 'application/json');

  const url = buildUrl(options.baseUrl ?? '', e, params, query);
  const doFetch = options.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      credentials: options.credentials ?? 'include',
      ...init,
      method: e.method,
      headers,
      body,
      ...(e.responds === 'redirect' ? { redirect: 'manual' as const } : {}),
    });
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw error;
    throw new ApiError(0, 'network', error instanceof Error ? error.message : String(error));
  }

  if (e.responds === 'redirect') {
    return { status: res.status, location: res.headers.get('location') } as OutputOf<E>;
  }
  const accepted = res.ok || (e.responds === 'json' && (e.alsoStatus ?? []).includes(res.status));
  if (!accepted) {
    const raw = await res.text().catch(() => '');
    let parsed: unknown = raw;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
    throw errorFrom(res.status, res.statusText, parsed);
  }
  if (e.responds === 'raw') return res as OutputOf<E>;
  if (e.responds === 'file') {
    return { blob: await res.blob(), filename: filenameFrom(res.headers.get('content-disposition')), contentType: res.headers.get('content-type') } as OutputOf<E>;
  }

  const raw = await res.text();
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    throw new ApiError(res.status, 'invalid_response', `${e.operationId}: the answer is not JSON`, raw);
  }
  if (!validate) return json as OutputOf<E>;
  const result = e.response.safeParse(json);
  if (!result.success) throw new ApiError(res.status, 'invalid_response', `${e.operationId}: the answer does not match the contract: ${result.error.message}`, json);
  return result.data as OutputOf<E>;
}

function method(e: Endpoint, options: ClientOptions): Method<EndpointDef> {
  const fn = e.multipart
    ? (form: unknown, extra?: unknown, init?: CallInit) => call(e, [form, extra], init, options)
    : (input?: unknown, init?: CallInit) => call(e, input, init, options);
  const url = (input: Record<string, unknown> = {}) => buildUrl(options.baseUrl ?? '', e, pick(input, pathParams(e.path)), pick(input, keysOf(e.query)));
  return Object.assign(fn, { endpoint: e, url }) as Method<EndpointDef>;
}

/** A client for the browser: same-origin by default, cookies included. */
export function createApiClient(options: ClientOptions = {}): ApiClient {
  return Object.fromEntries(Object.entries(endpoints).map(([module, defs]) => [
    module,
    Object.fromEntries(Object.entries(defs as Record<string, Endpoint>).map(([key, e]) => [key, method(e, options)])),
  ])) as unknown as ApiClient;
}

export type ServerClientOptions = Omit<ClientOptions, 'headers' | 'credentials'> & {
  /** Where the API listens from the web container, e.g. http://api:4000. */
  baseUrl: string;
  /**
   * The incoming request's headers, e.g. `() => headers()` from next/headers (this package does
   * not import Next). Read per request, so one client can be created per render or shared.
   */
  incoming: () => Headers | Promise<Headers> | Pick<Headers, 'get'> | Promise<Pick<Headers, 'get'>>;
  /** Incoming headers passed on; default the session cookie and the locale's Accept-Language. */
  forward?: readonly string[];
  /** Extra headers of the server's own. */
  headers?: HeaderSource;
};

export const FORWARDED_HEADERS = ['cookie', 'accept-language'] as const;

/**
 * For server components and route handlers in apps/web (SSR): forwards the browser's cookie, so
 * the API sees the same session. Set-Cookie answers do not reach the browser this way: anything
 * that changes the session (sign-in, client switch) goes through the browser client.
 */
export function createServerApiClient({ incoming, forward = FORWARDED_HEADERS, headers, ...rest }: ServerClientOptions): ApiClient {
  return createApiClient({
    ...rest,
    credentials: 'omit',
    headers: async () => {
      const from = await incoming();
      const out = await headersOf(headers);
      for (const name of forward) {
        const value = from.get(name);
        if (value) out.set(name, value);
      }
      return out;
    },
  });
}
