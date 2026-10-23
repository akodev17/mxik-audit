// HTTP client for the Didox API. IMPLEMENTED, NOT VERIFIED AGAINST DIDOX beyond the one public
// endpoint (GET /v1/measures/all answered 200 without auth on 23 Oct 2026). Every endpoint below
// is cited from docs/accounting-2026-10-23/integration-research.md §1; none is invented:
//   GET  /v1/measures/all                       official (live probe)
//   GET  /v1/documents?owner=&doctype=&status=&dateFrom=&page=&limit=   source A (1C library)
//   GET  /v1/documents/{id}                     source A and B
//   GET  /v1/documents/{id}/file/true → {file:{data:<base64 PDF>}}      source A
//   POST /v1/auth/{taxId}/password/{locale} {password} → {token}       source B (existence unverified)
//
// Two auth models, because the research found both (Unknown 2):
//   'token'   — the 1C library's: the user's token in BOTH `api-key` and `user-key`, no partner key;
//   'partner' — the npm SDK's: `Authorization: Bearer <partner token>` plus `user-key: <user token>`.
// The response shapes of the list and the document wrapper are [UNKNOWN] (Unknown 3), so they are
// read tolerantly (array, `{data}`, `{documents}`, `{items}`; id as `_id`, `doc_id`, `id`).
//
// Every call: a timeout, retries on 5xx / 429 / network errors with backoff, a per-org minimum
// interval between calls, and a log line with method, path (no query), status and time. Tokens
// travel only in headers and never reach a log line or an error message.

export const DIDOX_PROD_URL = 'https://api.didox.uz';
export const DIDOX_TEST_URL = 'https://testapi2.didox.uz';

/** DIDOX_API_URL, default production. */
export function didoxBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env['DIDOX_API_URL'] || DIDOX_PROD_URL).replace(/\/+$/, '');
}

export type DidoxAuth =
  | { kind: 'none' }
  | { kind: 'token'; token: string }
  | { kind: 'partner'; partnerToken: string; userToken: string };

export type DidoxErrorCode = 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'server' | 'timeout' | 'network' | 'bad_response' | 'client';

export class DidoxApiError extends Error {
  constructor(readonly code: DidoxErrorCode, readonly status: number | null, readonly path: string) {
    super(`didox ${code}${status ? ` (${status})` : ''} on ${path}`);
    this.name = 'DidoxApiError';
  }
}

/** Minimum spacing between calls of one org (a bucket of one): Didox's limits are [UNKNOWN]. */
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
};

export type Measure = { measureId: string; name: string };

/** A list entry, normalised; `raw` keeps whatever else Didox sent. */
export type DocumentEntry = { id: string; doctype: string | null; status: string | null; date: string | null; raw: Record<string, unknown> };

export type ListParams = {
  /** 0 = incoming (we are the buyer), 1 = outgoing (source A). */
  owner: 0 | 1;
  /** '002' = standard ЭСФ in source B; source A's Postman note says 001 (Unknown 2). */
  doctype?: string;
  status?: string | number;
  /** Filters by update date, not document date (source A). */
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
};

const sleeper = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

export class DidoxClient {
  readonly baseUrl: string;
  private readonly auth: DidoxAuth;
  private readonly orgKey: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: RateLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (line: string) => void;

  constructor(options: DidoxClientOptions) {
    this.baseUrl = (options.baseUrl ?? didoxBaseUrl()).replace(/\/+$/, '');
    this.auth = options.auth;
    this.orgKey = options.orgKey ?? 'global';
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retries = options.retries ?? 2;
    this.fetchImpl = options.fetch ?? fetch;
    this.limiter = options.limiter ?? defaultLimiter;
    this.sleep = options.sleep ?? sleeper;
    this.log = options.log ?? (() => undefined);
  }

  /** The auth headers of the configured model. Exposed for tests; never log the result. */
  authHeaders(): Record<string, string> {
    switch (this.auth.kind) {
      case 'token': return { 'api-key': this.auth.token, 'user-key': this.auth.token };
      case 'partner': return { Authorization: `Bearer ${this.auth.partnerToken}`, 'user-key': this.auth.userToken };
      default: return {};
    }
  }

  private async request(method: 'GET' | 'POST', path: string, query?: Record<string, string | number | undefined>, body?: unknown): Promise<unknown> {
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
          headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...this.authHeaders() },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
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
        lastError = new DidoxApiError(res.status === 429 ? 'rate_limited' : 'server', res.status, path);
        const retryAfter = Number(res.headers.get('retry-after'));
        if (res.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) await this.sleep(Math.min(retryAfter * 1000, 10_000));
        await res.body?.cancel().catch(() => undefined);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        const code: DidoxErrorCode = res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : res.status === 404 ? 'not_found' : 'client';
        throw new DidoxApiError(code, res.status, path);
      }
      try {
        return await res.json();
      } catch {
        throw new DidoxApiError('bad_response', res.status, path);
      }
    }
    throw lastError;
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

  /** GET /v1/documents — one page. */
  async listDocuments(params: ListParams): Promise<DocumentEntry[]> {
    const raw = await this.request('GET', '/v1/documents', {
      owner: params.owner, doctype: params.doctype, status: params.status, dateFrom: params.dateFrom, dateTo: params.dateTo,
      page: params.page ?? 1, limit: params.limit ?? 100,
    });
    const items = Array.isArray(raw) ? raw
      : isObj(raw) ? ([raw['data'], raw['documents'], raw['items'], raw['rows']].find(Array.isArray) as unknown[] | undefined) : undefined;
    if (!items) throw new DidoxApiError('bad_response', 200, '/v1/documents');
    return items.flatMap((e): DocumentEntry[] => {
      if (!isObj(e)) return [];
      const id = str(e['_id'] ?? e['doc_id'] ?? e['id'] ?? e['didox_id']);
      if (!id) return [];
      return [{
        id,
        doctype: str(e['doctype'] ?? e['doc_type'] ?? e['type']),
        status: str(e['doc_status'] ?? e['status']),
        date: str(e['doc_date'] ?? e['date'] ?? e['created'] ?? e['updated']),
        raw: e,
      }];
    });
  }

  /**
   * Pages through the list until a short page, `maxPages`, or `stop` (an entry already imported
   * when the list is newest first: the order is [UNKNOWN], so callers only stop on it when asked).
   */
  async *listAll(params: Omit<ListParams, 'page'>, maxPages = 50): AsyncGenerator<DocumentEntry[]> {
    const limit = params.limit ?? 100;
    for (let page = 1; page <= maxPages; page++) {
      const entries = await this.listDocuments({ ...params, limit, page });
      if (entries.length > 0) yield entries;
      if (entries.length < limit) return;
    }
  }

  /** GET /v1/documents/{id} — the document JSON (its wrapper is [UNKNOWN]; document.ts unwraps). */
  getDocument(id: string): Promise<unknown> {
    return this.request('GET', `/v1/documents/${encodeURIComponent(id)}`);
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

  /**
   * POST /v1/auth/{taxId}/password/{locale} — ИНН + password login (source B). Whether Didox still
   * offers it is [UNKNOWN] (Unknown 4); the service calls it only when DIDOX_PASSWORD_LOGIN=1.
   */
  async loginWithPassword(taxId: string, password: string, locale: 'ru' | 'uz' = 'ru'): Promise<{ token: string }> {
    const raw = await this.request('POST', `/v1/auth/${encodeURIComponent(taxId)}/password/${locale}`, undefined, { password });
    const token = isObj(raw) ? str(raw['token']) : null;
    if (!token) throw new DidoxApiError('bad_response', 200, '/v1/auth/{taxId}/password');
    return { token };
  }
}
