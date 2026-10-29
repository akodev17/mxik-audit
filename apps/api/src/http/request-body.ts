// Request bodies the global JSON/urlencoded parsers do not cover, read the way the web app's
// route handlers read them (request.formData(), request.json(), request.text()), so an upload,
// a provider callback or a form post is judged exactly as before. Each read has a byte cap
// (the caller's, else 1 MB like the global parsers): the bytes are counted as they arrive and a
// body past the cap is refused with 413 without being held (F20).
import { i18nFor } from '@tasnivo/i18n/locale';
import { ApiError } from './errors';
import { isPublicApi, requestLocale, type ApiRequest } from './request';

const KB = 1024;
const MB = 1024 * KB;

/** The global JSON/urlencoded parsers' limit (app.ts BODY_LIMIT). */
export const DEFAULT_BODY_CAP = MB;
/** Multipart framing and the text fields next to a capped file part, so a file at its cap still fits. */
export const MULTIPART_ALLOWANCE = 128 * KB;
/** Per-route caps: Click and Payme callbacks are a few hundred bytes. */
export const PAYMENT_CALLBACK_CAP = 64 * KB;
/** A refused body is read and dropped up to this, so the client gets the 413; past it the connection is closed. */
const DRAIN_LIMIT = 32 * MB;

export type BodyCap = { maxBytes?: number };

/** True when one of Nest's body parsers (JSON or urlencoded) read the stream and set req.body. */
const parsed = (req: ApiRequest): boolean => req.body !== undefined;

const contentType = (req: ApiRequest): string => (req.headers['content-type'] ?? '').toLowerCase();

/** The 413 in the API's error shape: the documented code on /api/v1, the reader's language elsewhere. */
export function bodyTooLarge(req: ApiRequest): ApiError {
  if (isPublicApi(req.path)) return ApiError.v1('too_large', 'The request body is too large.');
  return new ApiError(413, 'too_large', i18nFor(requestLocale(req)).ta.httpX.tooLarge);
}

/** The raw body, or a 413 once it passes `maxBytes` (declared or counted); nothing past the cap is kept. */
export function readBody(req: ApiRequest, { maxBytes = DEFAULT_BODY_CAP }: BodyCap = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    let over = Number.isFinite(declared) && declared > maxBytes;
    const chunks: Buffer[] = [];
    let size = 0;
    const done = (): void => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
    };
    const onData = (chunk: Buffer | string): void => {
      size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      if (size > maxBytes) over = true;
      if (!over) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        return;
      }
      chunks.length = 0;
      if (size > maxBytes + DRAIN_LIMIT) {
        done();
        req.destroy();
        reject(bodyTooLarge(req));
      }
    };
    const onEnd = (): void => {
      done();
      if (over) reject(bodyTooLarge(req));
      else resolve(Buffer.concat(chunks));
    };
    const onError = (error: Error): void => {
      done();
      reject(error);
    };
    const onClose = (): void => {
      if (req.complete) return;
      done();
      reject(new Error('request aborted'));
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
  });
}

/**
 * Reads the body to its end and keeps none of it, for a request refused before its body was read:
 * answering while the client still sends would reset the connection instead of showing the answer.
 */
export async function discardBody(req: ApiRequest): Promise<void> {
  if (parsed(req) || req.readableEnded) return;
  await readBody(req, { maxBytes: 0 }).catch(() => undefined);
}

/** The raw body as text; '' when a body parser already read it. */
export async function readText(req: ApiRequest, cap: BodyCap = {}): Promise<string> {
  if (parsed(req) || req.readableEnded) return '';
  return (await readBody(req, cap)).toString('utf8');
}

/**
 * A parsed urlencoded body (qs, extended) back as flat fields, as URLSearchParams would have
 * read them: a repeated name keeps its last value, `a[b]=1` stays the key "a[b]".
 */
export function flatFields(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  if (Array.isArray(value)) return value.length > 0 ? flatFields(value[value.length - 1], prefix) : [];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, v]) => flatFields(v, prefix ? `${prefix}[${key}]` : key));
  }
  return typeof value === 'number' || typeof value === 'boolean' ? [[prefix, String(value)]] : [];
}

/** The body as form fields: a urlencoded post (already parsed) or any other text read as one. */
export async function readFormFields(req: ApiRequest, cap: BodyCap = {}): Promise<Record<string, string>> {
  if (parsed(req)) return Object.fromEntries(flatFields(req.body));
  return Object.fromEntries(new URLSearchParams(await readText(req, cap)).entries());
}

/** The body as JSON: `{ json }`, or null when it is not JSON (request.json() rejecting). A body over the cap is a 413. */
export async function readJson(req: ApiRequest, cap: BodyCap = {}): Promise<{ json: unknown } | null> {
  if (parsed(req)) return contentType(req).includes('json') ? { json: req.body as unknown } : null;
  let text: string;
  try {
    text = await readText(req, cap);
  } catch (error) {
    // Only the cap is an answer of its own; a broken stream reads as "not JSON", as before.
    if (error instanceof ApiError) throw error;
    return null;
  }
  try {
    return { json: JSON.parse(text) as unknown };
  } catch {
    return null;
  }
}

/**
 * The body as web FormData, as request.formData() reads it: multipart (files included, held in
 * memory like the web app did) or urlencoded. Null when it is neither or does not parse; a body
 * over the cap is a 413.
 */
export async function readFormData(req: ApiRequest, cap: BodyCap = {}): Promise<FormData | null> {
  if (parsed(req)) {
    if (!contentType(req).includes('application/x-www-form-urlencoded')) return null;
    const form = new FormData();
    for (const [key, value] of flatFields(req.body)) form.append(key, value);
    return form;
  }
  if (req.readableEnded) return null;
  let body: Buffer;
  try {
    body = await readBody(req, cap);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return null;
  }
  const request = new Request('http://api.local/', {
    method: 'POST',
    headers: { 'content-type': req.headers['content-type'] ?? '' },
    // A view over the same bytes (Buffer types its memory as ArrayBufferLike, which BodyInit does not take).
    body: new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength),
  });
  return request.formData().catch(() => null);
}
