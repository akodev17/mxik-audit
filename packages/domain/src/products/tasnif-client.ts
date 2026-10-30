// Runtime client of the national classifier's public API (tasnif.soliq.uz/api/cls-api), for what
// the Excel export does not carry: a code's packaging list and activity status, the code behind a
// barcode, and the unit dictionary. Endpoints and shapes: docs/accounting-2026-10-23/tasnif-catalog.md
// (probed 2026-10-23) and tmp/real-docs/products/RESEARCH.md §1.2 (re-probed 2026-10-30; the recorded
// answers are in products/fixtures/tasnif/). An unknown code is "not found" whether the card answers
// 403 (2026-10-30), 200 with plain text (2026-10-23) or the gtin search answers success:false. No
// official documentation exists; these are the portal's own XHR calls, so every call has a
// timeout, retries with backoff, a process-wide rate limit and an in-memory cache, and the whole
// client can be switched off with TASNIF_LIVE=false (tests use a fake, never the network).

export const TASNIF_BASE_URL = 'https://tasnif.soliq.uz/api/cls-api';

/** One element of `packages[]` in /mxik/get/by-mxik, the fields the product module keeps. */
export type TasnifPackage = {
  code: string;
  parentCode: string | null;
  mxikCode: string;
  containerCode: number | null;
  containerName: string | null;
  unitId: number | null;
  unitName: string | null;
  parentValue: number | null;
  name: string;
  type: string | null;
  isUnitPackage: string | null;
};

/** /mxik/get/by-mxik: the code card. */
export type TasnifCard = {
  mxikCode: string;
  mxikName: string | null;
  /** `label`: 1 = the code is under mandatory digital marking (the repo's reading of the field). */
  label: number | null;
  packages: TasnifPackage[];
};

/** /integration-mxik/get/history/{code}: the only endpoint with `isActive` and `status`. */
export type TasnifHistory = {
  mxikCode: string;
  /** "1" → true, "0" → false, anything else → null. */
  isActive: boolean | null;
  status: number | null;
  packageNames: { code: string; nameUz: string | null; nameRu: string | null; nameLat: string | null; packageType: string | null }[];
};

/** /mxik/search/by-params?gtin=: the code tasnif holds for a barcode. */
export type TasnifGtinHit = { gtin: string; mxikCode: string; mxikName: string | null; label: number | null };

/** /integration-mxik/references/get/units/all: the unit dictionary (ids as in packages[].unitId). */
export type TasnifUnits = { units: { id: number; name: string }[]; recordTotal: number };

/**
 * not_found: the API says the code (or barcode) does not exist. unavailable: network, timeout or a
 * 5xx after retries. disabled: TASNIF_LIVE=false. needs_token: 401, the endpoint wants a taxpayer
 * cabinet token (never retried). incomplete: a list answered fewer rows than its recordTotal.
 */
export type TasnifFailure = 'not_found' | 'unavailable' | 'disabled' | 'needs_token' | 'incomplete';
export type TasnifAnswer<T> = { ok: true; value: T } | { ok: false; reason: TasnifFailure; detail?: string };

export type TasnifClient = {
  /** False when the kill switch is on: callers then skip live checks and say so. */
  readonly live: boolean;
  card(code: string, lang?: 'uz' | 'ru'): Promise<TasnifAnswer<TasnifCard>>;
  history(code: string): Promise<TasnifAnswer<TasnifHistory>>;
  /** The code behind a GTIN (`gtin=`; `barcode=` and `internationalCode=` are ignored by the API). */
  gtin(barcode: string): Promise<TasnifAnswer<TasnifGtinHit>>;
  /** The whole unit dictionary: `pageSize=100` (the default page is 10 of 90), checked against `recordTotal`. */
  units(lang?: 'uz' | 'ru'): Promise<TasnifAnswer<TasnifUnits>>;
};

export type TasnifOptions = {
  baseUrl?: string;
  /** Per request. */
  timeoutMs?: number;
  /** Extra attempts after the first, on network errors, timeouts, 429 and 5xx. */
  retries?: number;
  /** Requests in flight at once, across the whole process. */
  concurrency?: number;
  /** Minimum gap between two request starts, across the whole process. */
  minGapMs?: number;
  /** How long an answer (found or not found) is reused from memory. */
  cacheTtlMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULTS = { timeoutMs: 8_000, retries: 2, concurrency: 4, minGapMs: 60, cacheTtlMs: 60 * 60_000 } as const;
const CACHE_MAX = 5_000;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? v as Record<string, unknown> : {});

/** Reads one `packages[]` element; null when it has no code or no name. */
export function readPackage(raw: unknown, mxikCode: string): TasnifPackage | null {
  const p = record(raw);
  const code = str(p['code']);
  const name = str(p['name']);
  if (!code || !name) return null;
  return {
    code, name, mxikCode: str(p['mxikCode']) ?? mxikCode, parentCode: str(p['parentCode']),
    containerCode: num(p['containerCode']), containerName: str(p['containerName']),
    unitId: num(p['unitId']), unitName: str(p['unitName']), parentValue: num(p['parentValue']),
    type: str(p['type']), isUnitPackage: str(p['isUnitPackage']),
  };
}

/** The card as the API answers it (a bare object; "MXIK ma'lumotlari topilmadi" text when unknown). */
export function readCard(body: unknown, code: string): TasnifCard | null {
  const c = record(body);
  if (str(c['mxikCode']) !== code) return null;
  const packages = Array.isArray(c['packages']) ? c['packages'].map((p) => readPackage(p, code)).filter((p): p is TasnifPackage => p !== null) : [];
  return { mxikCode: code, mxikName: str(c['mxikName']), label: num(c['label']), packages };
}

/** The history envelope `{ success, data }`; null when `success` is false ("Mxik code not found!"). */
export function readHistory(body: unknown, code: string): TasnifHistory | null {
  const env = record(body);
  if (env['success'] !== true) return null;
  const d = record(env['data']);
  if (str(d['mxikCode']) !== code) return null;
  const active = str(d['isActive']);
  const names = Array.isArray(d['packageNames']) ? d['packageNames'] : [];
  return {
    mxikCode: code,
    isActive: active === '1' ? true : active === '0' ? false : null,
    status: num(d['status']),
    packageNames: names.flatMap((raw) => {
      const n = record(raw);
      const pc = str(n['code']);
      return pc ? [{ code: pc, nameUz: str(n['nameUz']), nameRu: str(n['nameRu']), nameLat: str(n['nameLat']), packageType: str(n['packageType']) }] : [];
    }),
  };
}

/**
 * The gtin search's page `{ success, data: { content[] } }`: the item whose `internationalCode` is
 * this barcode. `success:false` ("not data found") and a page of other items (a filter the API
 * ignored) are both no hit.
 */
export function readGtin(body: unknown, gtin: string): TasnifGtinHit | null {
  const env = record(body);
  if (env['success'] !== true) return null;
  const content = record(env['data'])['content'];
  const digits = gtin.replace(/^0+/, '');
  for (const raw of Array.isArray(content) ? content : []) {
    const item = record(raw);
    const code = str(item['mxikCode']);
    if (code && /^\d{17}$/.test(code) && (str(item['internationalCode']) ?? '').replace(/^0+/, '') === digits) {
      return { gtin, mxikCode: code, mxikName: str(item['mxikName']), label: num(item['label']) };
    }
  }
  return null;
}

/** The units envelope `{ success, data: [{id, name}], recordTotal }`. */
export function readUnits(body: unknown): TasnifUnits | null {
  const env = record(body);
  if (env['success'] !== true || !Array.isArray(env['data'])) return null;
  const units = env['data'].flatMap((raw) => {
    const u = record(raw);
    const id = num(u['id']);
    const name = str(u['name']);
    return id !== null && name ? [{ id, name }] : [];
  });
  return { units, recordTotal: num(env['recordTotal']) ?? units.length };
}

/** Process-wide limiter: at most `concurrency` requests in flight, starts at least `minGapMs` apart. */
class Limiter {
  private active = 0;
  private lastStart = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly concurrency: number, private readonly minGapMs: number, private readonly sleep: (ms: number) => Promise<void>) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    // A finishing request hands its slot straight to the next waiter, so `active` never overshoots.
    if (this.active >= this.concurrency) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      const now = Date.now();
      const startAt = Math.max(now, this.lastStart + this.minGapMs);
      this.lastStart = startAt;
      if (startAt > now) await this.sleep(startAt - now);
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

type Fetched = { status: number; body: unknown };

/** The live client. One instance per process is enough (tasnifClient() keeps it). */
export class HttpTasnifClient implements TasnifClient {
  readonly live = true;
  private readonly opts: Required<Omit<TasnifOptions, 'fetch' | 'sleep' | 'baseUrl'>> & { baseUrl: string };
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly limiter: Limiter;
  private readonly cache = new Map<string, { at: number; answer: TasnifAnswer<unknown> }>();
  /** Requests actually sent (cache misses, retries included), for the benchmark. */
  requests = 0;

  constructor(options: TasnifOptions = {}) {
    this.opts = {
      baseUrl: options.baseUrl ?? TASNIF_BASE_URL,
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      retries: options.retries ?? DEFAULTS.retries,
      concurrency: options.concurrency ?? DEFAULTS.concurrency,
      minGapMs: options.minGapMs ?? DEFAULTS.minGapMs,
      cacheTtlMs: options.cacheTtlMs ?? DEFAULTS.cacheTtlMs,
    };
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.limiter = new Limiter(this.opts.concurrency, this.opts.minGapMs, this.sleep);
  }

  card(code: string, lang: 'uz' | 'ru' = 'ru'): Promise<TasnifAnswer<TasnifCard>> {
    return this.cached(`card:${lang}:${code}`, `/mxik/get/by-mxik?mxikCode=${encodeURIComponent(code)}&lang=${lang}`, (body) => readCard(body, code));
  }

  history(code: string): Promise<TasnifAnswer<TasnifHistory>> {
    return this.cached(`history:${code}`, `/integration-mxik/get/history/${encodeURIComponent(code)}`, (body) => readHistory(body, code));
  }

  gtin(barcode: string): Promise<TasnifAnswer<TasnifGtinHit>> {
    return this.cached(`gtin:${barcode}`, `/mxik/search/by-params?gtin=${encodeURIComponent(barcode)}&lang=ru&page=0&size=5`, (body) => readGtin(body, barcode));
  }

  async units(lang: 'uz' | 'ru' = 'uz'): Promise<TasnifAnswer<TasnifUnits>> {
    const answer = await this.cached(`units:${lang}`, `/integration-mxik/references/get/units/all?pageSize=100&limit=100&lang=${lang}`, readUnits);
    if (answer.ok && answer.value.units.length < answer.value.recordTotal) {
      return { ok: false, reason: 'incomplete', detail: `${answer.value.units.length} of ${answer.value.recordTotal}` };
    }
    return answer;
  }

  /**
   * The taxpayer's own nomenclature for a code. Public callers have no cabinet token: the API answers
   * 401, which is `needs_token` at once (no retry, not cached as "not found").
   */
  nomenclature(code: string): Promise<TasnifAnswer<unknown>> {
    return this.cached(`nomenclature:${code}`, `/integration-nomenclature/get/by-mxik?mxikCode=${encodeURIComponent(code)}`, (body) => (body === '' ? null : body));
  }

  private async cached<T>(key: string, path: string, read: (body: unknown) => T | null): Promise<TasnifAnswer<T>> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.opts.cacheTtlMs) return hit.answer as TasnifAnswer<T>;
    const fetched = await this.get(path);
    let answer: TasnifAnswer<T>;
    if (!fetched.ok) answer = { ok: false, reason: 'unavailable', detail: fetched.detail };
    else if (fetched.value.status === 401) answer = { ok: false, reason: 'needs_token', detail: 'HTTP 401' };
    else {
      // 403 (an unknown or deactivated code on by-mxik, live 2026-10-30), 404 and a body the reader
      // refuses all mean the API does not know it.
      const value = fetched.value.status === 200 ? read(fetched.value.body) : null;
      answer = value === null ? { ok: false, reason: 'not_found' } : { ok: true, value };
    }
    // An outage is not remembered: the next lookup tries again.
    if (answer.ok || answer.reason === 'not_found') {
      if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(key, { at: Date.now(), answer });
    }
    return answer;
  }

  private async get(path: string): Promise<{ ok: true; value: Fetched } | { ok: false; detail: string }> {
    let detail = 'no attempt';
    for (let attempt = 0; attempt <= this.opts.retries; attempt++) {
      if (attempt > 0) await this.sleep(300 * 2 ** (attempt - 1));
      try {
        const res = await this.limiter.run(async () => {
          this.requests++;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
          try {
            const r = await this.fetchFn(`${this.opts.baseUrl}${path}`, { signal: controller.signal, headers: { accept: 'application/json' } });
            const text = await r.text();
            let body: unknown = text;
            try { body = JSON.parse(text); } catch { /* the card answers plain text for an unknown code */ }
            return { status: r.status, body };
          } finally {
            clearTimeout(timer);
          }
        });
        if (res.status === 429 || res.status >= 500) { detail = `HTTP ${res.status}`; continue; }
        return { ok: true, value: res };
      } catch (error) {
        detail = error instanceof Error ? (error.name === 'AbortError' ? 'timeout' : error.message) : String(error);
      }
    }
    return { ok: false, detail };
  }
}

/** TASNIF_LIVE=false: nothing leaves the process. */
export class DisabledTasnifClient implements TasnifClient {
  readonly live = false;
  card(): Promise<TasnifAnswer<TasnifCard>> { return Promise.resolve({ ok: false, reason: 'disabled' }); }
  history(): Promise<TasnifAnswer<TasnifHistory>> { return Promise.resolve({ ok: false, reason: 'disabled' }); }
  gtin(): Promise<TasnifAnswer<TasnifGtinHit>> { return Promise.resolve({ ok: false, reason: 'disabled' }); }
  units(): Promise<TasnifAnswer<TasnifUnits>> { return Promise.resolve({ ok: false, reason: 'disabled' }); }
}

/** Live unless TASNIF_LIVE is "false" / "0" / "off". */
export function tasnifLive(env: Record<string, string | undefined> = process.env): boolean {
  return !['false', '0', 'off', 'no'].includes((env['TASNIF_LIVE'] ?? '').trim().toLowerCase());
}

let shared: TasnifClient | null = null;

/** The process's client, built from the environment once; tests install a fake with useTasnifClient. */
export function tasnifClient(): TasnifClient {
  shared ??= tasnifLive() ? new HttpTasnifClient({ baseUrl: process.env['TASNIF_BASE_URL'] || TASNIF_BASE_URL }) : new DisabledTasnifClient();
  return shared;
}

/** Installs a client (a fake in tests); null goes back to the environment's. */
export function useTasnifClient(client: TasnifClient | null): void {
  shared = client;
}
