// HTTP client for the Didox API, per Didox's official integrator docs (api-docs.didox.uz, read
// 30 Oct 2026; RESEARCH.md §1). Verified only against the local fake server built from those docs'
// response examples (fake-server.ts) and, on the public measures list, against api.didox.uz.
//
// Hosts (§1.1):
//   https://api-partners.didox.uz   production partner API (Partner-Authorization + user-key)
//   https://testapi3.didox.uz       sandbox (user-key without a partner token; E-IMZO test key)
//   https://api.didox.uz            company integration of Didox's own 1C library (api-key + user-key)
// Endpoints:
//   GET  /v1/measures/all                                   public
//   GET  /v2/documents?page&limit&owner&doctype&status&dateFromUpdated&dateToUpdated
//        → {data:[…], total, next_page_url}  page and limit (1–100) are required; without `owner`
//        the list is OUTGOING, so the caller always names it (§1.3 row 1)
//   GET  /v1/documents?owner&doctype&status&dateFrom&page&limit   the 1C library's list, used when v2 answers 404
//   GET  /v1/documents/{id}?owner=0|1 → {data:{json, document, …}}       §1.3 row 3
//   GET  /v1/documents/{id}/archive → ZIP (JSON, PDF, signatures)         §1.3 row 17
//   GET  /v1/documents/{id}/file/true → {file:{data:<base64 PDF>}}        §1.3 row 16
//   GET  /v1/utils/not-included-products/{lang}, /v1/utils/compensation-works/{lang}   §1.6
//   POST /v1/auth/{taxId}/password/{locale} {password} → {token}           §1.2 (DIDOX_PASSWORD_LOGIN=1)
// Errors keep Didox's own words (§1.6 "Error formats", §5 V14): 401 plain text, 422/423/429
// `{message}`, `{error}`, `{title, message, description}` or a field map. They are cut to 300
// characters and never carry a token.
//
// Every call: a timeout, retries on 5xx / 429 / network errors with backoff, a per-org minimum
// interval between calls, and a log line with method, path (no query), status and time. Tokens
// travel only in headers and never reach a log line or an error message.

import { parseDidoxJson } from './document.js';

export const DIDOX_PARTNER_URL = 'https://api-partners.didox.uz';
export const DIDOX_SANDBOX_URL = 'https://testapi3.didox.uz';
export const DIDOX_COMPANY_URL = 'https://api.didox.uz';
/** Kept for callers of the earlier name: the company host. */
export const DIDOX_PROD_URL = DIDOX_COMPANY_URL;
/** Didox tokens live 360 minutes (§1.2). */
export const TOKEN_TTL_MS = 360 * 60_000;

/**
 * The base URL: DIDOX_API_URL when set (a fake server, a proxy), else the sandbox when
 * DIDOX_SANDBOX=1, else the production host of the auth model.
 */
export function didoxBaseUrl(env: Record<string, string | undefined> = process.env, kind: 'token' | 'partner' | 'none' = 'token'): string {
  if (env['DIDOX_API_URL']) return env['DIDOX_API_URL'].replace(/\/+$/, '');
  if (env['DIDOX_SANDBOX'] === '1') return DIDOX_SANDBOX_URL;
  return kind === 'partner' ? DIDOX_PARTNER_URL : DIDOX_COMPANY_URL;
}

export type DidoxAuth =
  | { kind: 'none' }
  | { kind: 'token'; token: string }
  | { kind: 'partner'; partnerToken: string; userToken: string }
  /** The sandbox (testapi3) takes the user token without a partner token (§1.1). */
  | { kind: 'user'; userToken: string };

export type DidoxErrorCode = 'unauthorized' | 'forbidden' | 'not_found' | 'unprocessable' | 'locked' | 'rate_limited' | 'server' | 'timeout' | 'network' | 'bad_response' | 'client' | 'token_expired';

export class DidoxApiError extends Error {
  constructor(readonly code: DidoxErrorCode, readonly status: number | null, readonly path: string, readonly detail: string | null = null) {
    super(`didox ${code}${status ? ` (${status})` : ''} on ${path}`);
    this.name = 'DidoxApiError';
  }
}

/** Didox's own message from an error body, verbatim but bounded; null when the body says nothing. */
export function errorDetail(body: string, secrets: readonly string[] = []): string | null {
  let text = body.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>;
      const err = o['error'] && typeof o['error'] === 'object' ? (o['error'] as Record<string, unknown>) : null;
      const parts = [o['title'], o['message'], o['description'], typeof o['error'] === 'string' ? o['error'] : null, err?.['message'], err?.['reason']]
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
      if (parts.length > 0) text = [...new Set(parts)].join(' — ');
      else {
        // A field map {"field": ["text"]}.
        const fields = Object.entries(o).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k}: ${(v as unknown[]).join(', ')}`);
        text = fields.length > 0 ? fields.join('; ') : JSON.stringify(parsed);
      }
    }
  } catch { /* plain text, e.g. "Unauthorized. Invalid user key" */ }
  for (const secret of secrets) if (secret) text = text.split(secret).join('***');
  return text.replace(/\s+/g, ' ').slice(0, 300) || null;
}

/** Minimum spacing between calls of one org (a bucket of one): Didox's limits are not published. */
export class RateLimiter {
  private readonly next = new Map<string, number>();
  constructor(readonly minIntervalMs: number) {}

  async wait(key: string, sleep: (ms: number) => Promise<void>): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next.get(key) ?? 0);
    this.next.set(key, at + this.minIntervalMs);
    if (at > now) await sleep(at - now);
  }
}

/** Shared by every client in the process: one org's sync cannot starve another's. */
export const defaultLimiter = new RateLimiter(250);

export type DidoxClientOptions = {
  baseUrl?: string;
  auth: DidoxAuth;
  /** When the token stops being valid; a call after it fails with token_expired before reaching Didox. */
  tokenExpiresAt?: Date | null;
  /** The key the rate limit is kept under (the org id). */
  orgKey?: string;
  timeoutMs?: number;
  /** Extra attempts after the first on a retryable failure. */
  retries?: number;
  fetch?: typeof fetch;
  limiter?: RateLimiter;
  sleep?: (ms: number) => Promise<void>;
  /** One line per call; never receives a token, a query string or a body. */
  log?: (line: string) => void;
  /** 'ru' | 'uz' for Accept-Language (Didox words its errors in it). */
  locale?: 'ru' | 'uz';
};

export type Measure = { measureId: string; name: string };

/** A list entry, normalised; `raw` keeps whatever else Didox sent (totals, roaming_id, status_comment). */
export type DocumentEntry = {
  id: string; doctype: string | null; status: string | null; date: string | null;
  /** The roaming (soliq) id, 24 hex; the same invoice under `facturaid` inside the document. */
  roamingId: string | null;
  updated: string | null;
  raw: Record<string, unknown>;
};

export type ListParams = {
  /** 0 = incoming (we are the buyer), 1 = outgoing. Always sent: Didox's default is outgoing. */
  owner: 0 | 1;
  /** One doctype or a comma list ("002,008,023"). */
  doctype?: string;
  status?: string | number;
  /** `yyyy-mm-dd`: documents updated on or after (v2 `dateFromUpdated`, v1 `dateFrom`). */
  dateFromUpdated?: string;
  dateToUpdated?: string;
  /** Earlier name of dateFromUpdated. */
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
};

export type ListPage = { entries: DocumentEntry[]; total: number | null; nextPageUrl: string | null | undefined };

const sleeper = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

const STATUS_CODES: Record<number, DidoxErrorCode> = { 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 422: 'unprocessable', 423: 'locked' };

export class DidoxClient {
  readonly baseUrl: string;
  private readonly auth: DidoxAuth;
  private readonly tokenExpiresAt: Date | null;
  private readonly orgKey: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: RateLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (line: string) => void;
  private readonly locale: 'ru' | 'uz';
  /** Set once /v2/documents answered 404 (a host that only has the 1C library's v1 list). */
  private v1List = false;

  constructor(options: DidoxClientOptions) {
    this.baseUrl = (options.baseUrl ?? didoxBaseUrl(process.env, options.auth.kind === 'partner' ? 'partner' : 'token')).replace(/\/+$/, '');
    this.auth = options.auth;
    this.tokenExpiresAt = options.tokenExpiresAt ?? null;
    this.orgKey = options.orgKey ?? 'global';
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retries = options.retries ?? 2;
    this.fetchImpl = options.fetch ?? fetch;
    this.limiter = options.limiter ?? defaultLimiter;
    this.sleep = options.sleep ?? sleeper;
    this.log = options.log ?? (() => undefined);
    this.locale = options.locale ?? 'ru';
  }

  /** The auth headers of the configured model (§1.2). Exposed for tests; never log the result. */
  authHeaders(): Record<string, string> {
    switch (this.auth.kind) {
      case 'token': return { 'api-key': this.auth.token, 'user-key': this.auth.token };
      // `Authorization: Bearer` is not accepted by the partner API (§1.2).
      case 'partner': return { 'Partner-Authorization': this.auth.partnerToken, 'user-key': this.auth.userToken };
      case 'user': return { 'user-key': this.auth.userToken };
      default: return {};
    }
  }

  /** A password in flight (loginWithPassword): masked in an error body like a token. */
  private inFlight: string[] = [];

  private secrets(): string[] {
    switch (this.auth.kind) {
      case 'token': return [this.auth.token, ...this.inFlight];
      case 'partner': return [this.auth.partnerToken, this.auth.userToken, ...this.inFlight];
      case 'user': return [this.auth.userToken, ...this.inFlight];
      default: return [...this.inFlight];
    }
  }

  private async send(method: 'GET' | 'POST', path: string, query: Record<string, string | number | undefined> | undefined, body: unknown, accept: 'json' | 'binary'): Promise<Response> {
    if (this.auth.kind !== 'none' && this.tokenExpiresAt && this.tokenExpiresAt.getTime() <= Date.now()) {
      throw new DidoxApiError('token_expired', null, path);
    }
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') search.set(k, String(v));
    const url = `${this.baseUrl}${path}${search.size ? `?${search}` : ''}`;
    let lastError: DidoxApiError = new DidoxApiError('network', null, path);
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await this.sleep(Math.min(300 * 2 ** (attempt - 1), 5_000));
      await this.limiter.wait(this.orgKey, this.sleep);
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: {
            Accept: accept === 'json' ? 'application/json' : 'application/zip, application/octet-stream, */*',
            'Accept-Language': this.locale,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...this.authHeaders(),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
          redirect: 'error',
        });
      } catch {
        clearTimeout(timer);
        const code = controller.signal.aborted ? 'timeout' : 'network';
        this.log(`didox ${method} ${path} ${code} ${Date.now() - started}ms attempt ${attempt + 1}`);
        lastError = new DidoxApiError(code, null, path);
        continue;
      }
      clearTimeout(timer);
      this.log(`didox ${method} ${path} ${res.status} ${Date.now() - started}ms attempt ${attempt + 1}`);
      if (res.status === 429 || res.status >= 500) {
        const detail = errorDetail(await res.text().catch(() => ''), this.secrets());
        lastError = new DidoxApiError(res.status === 429 ? 'rate_limited' : 'server', res.status, path, detail);
        const retryAfter = Number(res.headers.get('retry-after'));
        if (res.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) await this.sleep(Math.min(retryAfter * 1000, 10_000));
        continue;
      }
      if (!res.ok) {
        const detail = errorDetail(await res.text().catch(() => ''), this.secrets());
        throw new DidoxApiError(STATUS_CODES[res.status] ?? 'client', res.status, path, detail);
      }
      return res;
    }
    throw lastError;
  }

  private async request(method: 'GET' | 'POST', path: string, query?: Record<string, string | number | undefined>, body?: unknown): Promise<unknown> {
    const res = await this.send(method, path, query, body, 'json');
    const text = await res.text();
    try {
      // The same reader as an upload: a numeric 17-digit code or 20-digit account keeps its digits (§7.5).
      return parseDidoxJson(text);
    } catch {
      throw new DidoxApiError('bad_response', res.status, path);
    }
  }

  /** GET /v1/measures/all — public; Didox's own unit ids (strings), not tasnif ones. */
  async measures(): Promise<Measure[]> {
    const raw = await this.request('GET', '/v1/measures/all');
    const items = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw['data']) ? (raw['data'] as unknown[]) : null;
    if (!items) throw new DidoxApiError('bad_response', 200, '/v1/measures/all');
    return items.flatMap((m) => {
      if (!isObj(m)) return [];
      const id = str(m['measureId'] ?? m['measureid'] ?? m['id']);
      const name = str(m['name']);
      return id && name ? [{ measureId: id, name }] : [];
    });
  }

  /** One page of the document list: /v2/documents, or the v1 list on a host without v2. */
  async listPage(params: ListParams): Promise<ListPage> {
    const page = params.page ?? 1;
    const limit = Math.max(1, Math.min(100, params.limit ?? 100));
    const from = params.dateFromUpdated ?? params.dateFrom;
    const to = params.dateToUpdated ?? params.dateTo;
    let raw: unknown;
    let path = '/v2/documents';
    if (!this.v1List) {
      try {
        raw = await this.request('GET', path, { owner: params.owner, doctype: params.doctype, status: params.status, dateFromUpdated: from, dateToUpdated: to, page, limit });
      } catch (error) {
        if (!(error instanceof DidoxApiError && error.code === 'not_found')) throw error;
        this.v1List = true;
      }
    }
    if (this.v1List) {
      path = '/v1/documents';
      raw = await this.request('GET', path, { owner: params.owner, doctype: params.doctype, status: params.status, dateFrom: from, dateTo: to, page, limit });
    }
    const items = Array.isArray(raw) ? raw
      : isObj(raw) ? ([raw['data'], raw['documents'], raw['items'], raw['rows']].find(Array.isArray) as unknown[] | undefined) : undefined;
    if (!items) throw new DidoxApiError('bad_response', 200, path);
    const entries = items.flatMap((e): DocumentEntry[] => {
      if (!isObj(e)) return [];
      const id = str(e['doc_id'] ?? e['_id'] ?? e['id'] ?? e['didox_id']);
      if (!id) return [];
      return [{
        id,
        doctype: str(e['doctype'] ?? e['doc_type'] ?? e['type']),
        status: str(e['doc_status'] ?? e['status']),
        date: str(e['doc_date'] ?? e['date'] ?? e['created'] ?? e['updated']),
        roamingId: str(e['roaming_id']),
        updated: str(e['updated_date'] ?? e['updated']),
        raw: e,
      }];
    });
    const total = isObj(raw) && typeof raw['total'] === 'number' ? raw['total'] : null;
    // undefined: the answer has no paging field at all (a bare array), so a short page ends the list.
    const nextPageUrl = isObj(raw) && 'next_page_url' in raw ? str(raw['next_page_url']) : undefined;
    return { entries, total, nextPageUrl };
  }

  /** One page's entries. */
  async listDocuments(params: ListParams): Promise<DocumentEntry[]> {
    return (await this.listPage(params)).entries;
  }

  /**
   * Pages through the list: while `next_page_url` names a next page, or (an answer without that
   * field) until a short page; never beyond `maxPages`. `startPage` resumes an interrupted run.
   */
  async *listAll(params: Omit<ListParams, 'page'>, maxPages = 50, startPage = 1): AsyncGenerator<DocumentEntry[] & { page?: number }> {
    const limit = params.limit ?? 100;
    for (let page = startPage; page < startPage + maxPages; page++) {
      const { entries, nextPageUrl } = await this.listPage({ ...params, limit, page });
      if (entries.length > 0) yield Object.assign(entries, { page });
      if (nextPageUrl === null) return;
      if (nextPageUrl === undefined && entries.length < limit) return;
      if (entries.length === 0) return;
    }
  }

  /** GET /v1/documents/{id}?owner= — the `{data:{json, document}}` envelope; document.ts unwraps it. */
  getDocument(id: string, owner?: 0 | 1): Promise<unknown> {
    return this.request('GET', `/v1/documents/${encodeURIComponent(id)}`, owner === undefined ? undefined : { owner });
  }

  /** GET /v1/documents/{id}/archive — the ZIP Didox's "Скачать" gives (JSON, PDF, signatures, readme). */
  async getArchive(id: string): Promise<Buffer | null> {
    const res = await this.send('GET', `/v1/documents/${encodeURIComponent(id)}/archive`, undefined, undefined, 'binary');
    const buffer = Buffer.from(await res.arrayBuffer());
    // PK\x03\x04: a ZIP; anything else (an HTML error page under 200) is no archive.
    return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b ? buffer : null;
  }

  /** GET /v1/documents/{id}/file/true — the PDF print form, or null when the answer holds none. */
  async getDocumentPdf(id: string): Promise<Buffer | null> {
    const raw = await this.request('GET', `/v1/documents/${encodeURIComponent(id)}/file/true`);
    const file = isObj(raw) && isObj(raw['file']) ? raw['file'] : raw;
    const data = isObj(file) ? str(file['data']) : null;
    if (!data) return null;
    const pdf = Buffer.from(data.replace(/^data:[^,]*,/, ''), 'base64');
    return pdf.subarray(0, 5).toString('latin1') === '%PDF-' ? pdf : null;
  }

  /** The ИКПУ whose VAT the buyer cannot credit, and those of reimbursement invoices (§1.6, V9). */
  async restrictedLists(): Promise<{ notIncluded: Set<string>; compensation: Set<string> }> {
    const codes = (raw: unknown): Set<string> => {
      const items = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw['data']) ? (raw['data'] as unknown[]) : [];
      return new Set(items.flatMap((i) => {
        const code = str(isObj(i) ? i['catalogCode'] ?? i['catalog_code'] ?? i['code'] ?? i['classCode'] : i);
        return code && /^\d{17}$/.test(code) ? [code] : [];
      }));
    };
    const [notIncluded, compensation] = await Promise.all([
      this.request('GET', `/v1/utils/not-included-products/${this.locale}`),
      this.request('GET', `/v1/utils/compensation-works/${this.locale}`),
    ]);
    return { notIncluded: codes(notIncluded), compensation: codes(compensation) };
  }

  /**
   * POST /v1/auth/{taxId}/password/{locale} — ИНН + password login (§1.2); the token lives
   * TOKEN_TTL_MS. The service calls it only when DIDOX_PASSWORD_LOGIN=1.
   */
  async loginWithPassword(taxId: string, password: string, locale: 'ru' | 'uz' = 'ru'): Promise<{ token: string }> {
    // A 422 field map that echoed the password would otherwise reach the admin's screen as Didox's words (R-D14).
    this.inFlight = [password];
    let raw: unknown;
    try {
      raw = await this.request('POST', `/v1/auth/${encodeURIComponent(taxId)}/password/${locale}`, undefined, { password });
    } finally {
      this.inFlight = [];
    }
    const token = isObj(raw) ? str(raw['token']) : null;
    if (!token) throw new DidoxApiError('bad_response', 200, '/v1/auth/{taxId}/password');
    return { token };
  }
}
