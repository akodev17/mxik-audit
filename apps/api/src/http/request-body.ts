// Request bodies the global JSON/urlencoded parsers do not cover, read the way the web app's
// route handlers read them (request.formData(), request.json(), request.text()), so an upload,
// a provider callback or a form post is judged exactly as before.
import { Readable } from 'node:stream';
import type { ApiRequest } from './request';

/** True when one of Nest's body parsers (JSON or urlencoded) read the stream and set req.body. */
const parsed = (req: ApiRequest): boolean => req.body !== undefined;

const contentType = (req: ApiRequest): string => (req.headers['content-type'] ?? '').toLowerCase();

/** The raw body as text; '' when a body parser already read it. */
export async function readText(req: ApiRequest): Promise<string> {
  if (parsed(req) || req.readableEnded) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
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
export async function readFormFields(req: ApiRequest): Promise<Record<string, string>> {
  if (parsed(req)) return Object.fromEntries(flatFields(req.body));
  return Object.fromEntries(new URLSearchParams(await readText(req)).entries());
}

/** The body as JSON: `{ json }`, or null when it is not JSON (request.json() rejecting). */
export async function readJson(req: ApiRequest): Promise<{ json: unknown } | null> {
  if (parsed(req)) return contentType(req).includes('json') ? { json: req.body as unknown } : null;
  try {
    return { json: JSON.parse(await readText(req)) as unknown };
  } catch {
    return null;
  }
}

/**
 * The body as web FormData, as request.formData() reads it: multipart (files included, held in
 * memory like the web app did) or urlencoded. Null when it is neither or does not parse.
 */
export async function readFormData(req: ApiRequest): Promise<FormData | null> {
  if (parsed(req)) {
    if (!contentType(req).includes('application/x-www-form-urlencoded')) return null;
    const form = new FormData();
    for (const [key, value] of flatFields(req.body)) form.append(key, value);
    return form;
  }
  if (req.readableEnded) return null;
  const request = new Request('http://api.local/', {
    method: 'POST',
    headers: { 'content-type': req.headers['content-type'] ?? '' },
    body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  return request.formData().catch(() => null);
}
