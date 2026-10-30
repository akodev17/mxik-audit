// The 1C OData standard interface, as a real base expects it (research note onec §5, checklist
// §8.25–34; tested against a fake server built from the saved responses of the official 1C:Fresh
// guide, 42clouds' reprint of the 1C administrator guide and the mista thread, see
// fixtures/odata/SOURCES.md). What a client must not get wrong:
// - names come from the base's $metadata (cached by its hash), never assumed (§8.34);
// - the composition is empty by default: a missing set or attribute is an actionable problem (§8.25);
// - nothing is followed on a redirect, and plain http works with a warning (§8.26);
// - a document is created with its tabular part in one POST without any Ref_Key, the rows are read
//   back, and a tabular part's own entity set is never written (§8.27, error 13);
// - documents are created unposted and Post() is a separate call whose 500 is a business refusal (§8.28);
// - a PATCH resends the whole tabular part with If-Match: DataVersion; 412 = re-read and retry (§8.29);
// - deleting is DeletionMark=true by PATCH; this client has no DELETE at all (§8.30);
// - lists page with $top/$skip/$inlinecount, drop folders, and retry with allowedOnly on 401 (§8.31);
// - composite references filter with cast(guid'…','Catalog_X') (§8.32); dates are datetime'…'
//   without a zone and LineNumber is a string (§8.33).
// IMPLEMENTED BUT NOT VERIFIED against a real «Бухгалтерия для Узбекистана» base (none available).
import { createHash } from 'node:crypto';

export type ODataCredentials = { baseUrl: string; username: string | null; password: string | null };

export const REQUEST_TIMEOUT_MS = 10_000;
export const odataRoot = (baseUrl: string): string => `${baseUrl}/odata/standard.odata`;
export const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

/** The internal codes of 1C's OData error envelope (42clouds, «ошибочные ситуации»), as machine words. */
export const ODATA_ERROR_CODES: Readonly<Record<number, string>> = {
  0: 'not_supported', 1: 'unparsable', 2: 'bad_request', 3: 'representation_unsupported', 4: 'bad_value', 5: 'value_required',
  6: 'bad_url', 7: 'key_incomplete', 8: 'type_not_found', 9: 'not_found', 10: 'property_not_found', 11: 'method_not_found',
  12: 'argument_missing', 13: 'rows_direct', 14: 'options_unparsable', 15: 'key_exists', 16: 'property_not_assigned',
  17: 'load_mode_unsupported', 18: 'duplicate_names', 19: 'method_forbidden', 20: 'access_denied',
};

// ── Literals (§8.32, §8.33) ──────────────────────────────────────────────────────────────────

/** A string literal: single quotes doubled. */
export const str = (value: string): string => `'${value.replace(/'/g, "''")}'`;
export const guid = (ref: string): string => `guid'${ref}'`;
/** `datetime'YYYY-MM-DDTHH:MM:SS'`, no zone: 1C reads it as the base's local time. */
export const datetime = (isoDate: string, time = '00:00:00'): string => `datetime'${isoDate.slice(0, 10)}T${time}'`;
/** A composite reference compared in $filter: `cast(guid'…','Catalog_X')`. */
export const castRef = (ref: string, entitySet: string): string => `cast(${guid(ref)}, ${str(entitySet)})`;
/** A date as a body value: local midnight, no zone. */
export const bodyDate = (isoDate: string): string => `${isoDate.slice(0, 10)}T00:00:00`;

// ── $metadata (§8.25, §8.34) ─────────────────────────────────────────────────────────────────

export type EntityShape = {
  /** Properties of the entity type; empty when the $metadata gave no type (then nothing is checked). */
  properties: Set<string>;
  /** Tabular parts: name → the row type's properties. */
  parts: Map<string, Set<string>>;
  typed: boolean;
};

export type Metadata = { hash: string; sets: Map<string, EntityShape> };

const attrs = (tag: string): Record<string, string> => Object.fromEntries([...tag.matchAll(/([\w:.]+)="([^"]*)"/g)].map((m) => [m[1] ?? '', m[2] ?? '']));
const localName = (type: string): string => type.replace(/^Collection\((.*)\)$/, '$1').replace(/^.*\./, '');

/** The entity sets of a CSDL document with their properties and tabular parts. */
export function parseMetadata(xml: string): Metadata {
  const props = (body: string): Map<string, string> =>
    new Map([...body.matchAll(/<Property\b([^>]*?)\/?>/g)].map((m) => { const a = attrs(m[1] ?? ''); return [a['Name'] ?? '', a['Type'] ?? '']; }));
  const types = new Map<string, Map<string, string>>();
  for (const m of xml.matchAll(/<(EntityType|ComplexType)\b([^>]*)>([\s\S]*?)<\/\1>/g)) types.set(attrs(m[2] ?? '')['Name'] ?? '', props(m[3] ?? ''));
  const sets = new Map<string, EntityShape>();
  for (const m of xml.matchAll(/<EntitySet\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1] ?? '');
    const name = a['Name'];
    if (!name) continue;
    const type = types.get(localName(a['EntityType'] ?? name));
    const parts = new Map<string, Set<string>>();
    for (const [prop, t] of type ?? []) {
      if (!t.startsWith('Collection(')) continue;
      parts.set(prop, new Set((types.get(localName(t)) ?? new Map()).keys()));
    }
    sets.set(name, { properties: new Set(type?.keys() ?? []), parts, typed: Boolean(type) });
  }
  return { hash: createHash('sha256').update(xml).digest('hex'), sets };
}

/** True for a tabular part's own entity set (`Document_X_Товары`): 1C refuses rows written there (code 13). */
export function isTabularSet(md: Metadata, entitySet: string): boolean {
  for (const [name, shape] of md.sets) {
    if (entitySet.startsWith(`${name}_`) && shape.parts.has(entitySet.slice(name.length + 1))) return true;
  }
  return false;
}

/** How an attribute is written: a plain reference (`X_Key`), a composite one (`X` + `X_Type`), or unknown (no type). */
export function refShape(md: Metadata, entitySet: string, attribute: string): 'plain' | 'composite' | 'missing' | 'unknown' {
  const shape = md.sets.get(entitySet);
  if (!shape?.typed) return 'unknown';
  if (shape.properties.has(`${attribute}_Key`)) return 'plain';
  if (shape.properties.has(attribute) && shape.properties.has(`${attribute}_Type`)) return 'composite';
  return 'missing';
}

// ── Errors ───────────────────────────────────────────────────────────────────────────────────

/** 1C's error envelope, JSON (`odata.error`) or XML (`m:error`); null fields when the body has none. */
export function parseODataError(text: string): { code: number | null; message: string | null } {
  try {
    const json = JSON.parse(text) as { 'odata.error'?: { code?: unknown; message?: { value?: unknown } | string } };
    const e = json['odata.error'];
    if (e) {
      const code = e.code === '' || e.code === undefined || e.code === null ? null : Number(e.code);
      const message = typeof e.message === 'string' ? e.message : typeof e.message?.value === 'string' ? e.message.value : null;
      return { code: Number.isInteger(code) ? code : null, message };
    }
  } catch { /* not JSON */ }
  const code = /<m:code>\s*(\d+)\s*<\/m:code>/.exec(text)?.[1];
  const message = /<m:message[^>]*>([\s\S]*?)<\/m:message>/.exec(text)?.[1]?.trim();
  return { code: code === undefined ? null : Number(code), message: message ? message.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null };
}

/** The machine reason of a refused call. A 403 is not "wrong password": the object or a new attribute may be outside the composition. */
export function reasonOf(status: number, code: number | null): string {
  if (status === 401) return 'auth_failed';
  if (status === 403) return code === 20 ? 'access_denied' : 'forbidden_or_not_published';
  if (status === 412) return 'version_conflict';
  if (status >= 300 && status < 400) return 'redirected';
  if (code !== null && ODATA_ERROR_CODES[code]) return `onec_${ODATA_ERROR_CODES[code]}`;
  if (status >= 500) return 'onec_server_error';
  return 'onec_refused';
}

/** A network failure in words safe to store: the timeout or the error's code, never a header. */
export function networkFailure(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'timeout';
  const code = (error as { cause?: { code?: string } })?.cause?.code;
  return code ? `unreachable:${code}` : 'unreachable';
}

// ── The client ───────────────────────────────────────────────────────────────────────────────

export type Answer = { ok: true; status: number; json: Record<string, unknown> | null } | { ok: false; status: number | null; reason: string; code: number | null; message: string | null; location?: string };

type Method = 'GET' | 'POST' | 'PATCH';

/** A write left to 1C without the platform's own keys: no Ref_Key on the document or on any row. */
export function withoutKeys(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'Ref_Key' || k === 'odata.metadata' || k === 'DataVersion') continue;
    out[k] = Array.isArray(v) ? v.map((row) => (row && typeof row === 'object' ? Object.fromEntries(Object.entries(row as Record<string, unknown>).filter(([rk]) => rk !== 'Ref_Key')) : row)) : v;
  }
  return out;
}

export class ODataClient {
  readonly insecure: boolean;
  constructor(readonly c: ODataCredentials, private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = REQUEST_TIMEOUT_MS) {
    this.insecure = c.baseUrl.startsWith('http:');
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const auth: Record<string, string> = this.c.username ? { authorization: `Basic ${Buffer.from(`${this.c.username}:${this.c.password ?? ''}`, 'utf8').toString('base64')}` } : {};
    return { ...auth, accept: 'application/json', ...extra };
  }

  /** One call. Redirects are never followed: a POST turned into a GET by an http→https hop would read, not write (§8.26). */
  async call(method: Method, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Answer> {
    if ((method as string) === 'DELETE') throw new Error('1C objects are never deleted physically: PATCH DeletionMark instead (§8.30)');
    let res: Response;
    try {
      res = await this.fetcher(`${odataRoot(this.c.baseUrl)}/${path}`, {
        method, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs),
        headers: this.headers(body === undefined ? extra : { 'content-type': 'application/json; charset=utf-8', ...extra }),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      return { ok: false, status: null, reason: networkFailure(error), code: null, message: null };
    }
    const text = await res.text().catch(() => '');
    if (res.status >= 200 && res.status < 300) {
      let json: Record<string, unknown> | null = null;
      try { json = text ? JSON.parse(text) as Record<string, unknown> : null; } catch { json = null; }
      return { ok: true, status: res.status, json };
    }
    const e = parseODataError(text);
    const header = res.headers.get('location');
    let location = header;
    try { location = header ? decodeURI(header) : null; } catch { /* kept as sent */ }
    return {
      ok: false, status: res.status, reason: reasonOf(res.status, e.code), code: e.code,
      message: (e.message ?? (text && !text.trimStart().startsWith('<') ? text.slice(0, 500) : null) ?? `HTTP ${res.status}`).slice(0, 1000),
      ...(location ? { location } : {}),
    };
  }

  /** `$metadata` as text, or the refusal. */
  async metadata(): Promise<{ ok: true; xml: string } | Extract<Answer, { ok: false }>> {
    let res: Response;
    try {
      res = await this.fetcher(`${odataRoot(this.c.baseUrl)}/$metadata`, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs), headers: this.headers({ accept: 'application/xml' }) });
    } catch (error) {
      return { ok: false, status: null, reason: networkFailure(error), code: null, message: null };
    }
    const text = (await res.text().catch(() => '')).slice(0, 20_000_000);
    if (res.status >= 200 && res.status < 300) return { ok: true, xml: text };
    const e = parseODataError(text);
    return { ok: false, status: res.status, reason: res.status === 403 ? 'auth_failed' : reasonOf(res.status, e.code), code: e.code, message: e.message };
  }

  /**
   * One page of a list. On 401 the same query is asked once more with `allowedOnly=true`: with
   * record-level restrictions 1C refuses the whole list instead of hiding rows (§8.31).
   */
  async page(entitySet: string, q: { filter?: string; select?: string[]; top?: number; skip?: number; count?: boolean; orderby?: string }): Promise<{ ok: true; rows: Record<string, unknown>[]; count: number | null } | Extract<Answer, { ok: false }>> {
    const params = ['$format=json'];
    if (q.filter) params.push(`$filter=${encodeURIComponent(q.filter)}`);
    if (q.select?.length) params.push(`$select=${encodeURIComponent(q.select.join(','))}`);
    if (q.orderby) params.push(`$orderby=${encodeURIComponent(q.orderby)}`);
    if (q.top !== undefined) params.push(`$top=${q.top}`);
    if (q.skip) params.push(`$skip=${q.skip}`);
    if (q.count) params.push('$inlinecount=allpages');
    const path = `${encodeURIComponent(entitySet)}?${params.join('&')}`;
    let answer = await this.call('GET', path);
    if (!answer.ok && answer.status === 401) {
      const retry = await this.call('GET', `${path}&allowedOnly=true`);
      if (retry.ok || retry.status !== 401) answer = retry;
    }
    if (!answer.ok) return answer;
    const rows = Array.isArray(answer.json?.['value']) ? answer.json['value'] as Record<string, unknown>[] : [];
    // 1C writes the count as a string ("odata.count": "28").
    const raw = answer.json?.['odata.count'];
    const count = raw === undefined ? null : Number(raw);
    return { ok: true, rows, count: Number.isFinite(count) ? count : null };
  }

  /** Every row of a list, `pageSize` at a time, folders and deleted items left out when the set has them. */
  async listAll(entitySet: string, q: { filter?: string; select?: string[]; folders?: boolean; pageSize?: number; max?: number } = {}): Promise<{ ok: true; rows: Record<string, unknown>[]; count: number | null } | Extract<Answer, { ok: false }>> {
    const pageSize = q.pageSize ?? 1000;
    const max = q.max ?? 100_000;
    const conditions = [q.folders ? 'IsFolder eq false' : null, 'DeletionMark eq false', q.filter ? `(${q.filter})` : null].filter(Boolean);
    const rows: Record<string, unknown>[] = [];
    let count: number | null = null;
    for (let skip = 0; rows.length < max; skip += pageSize) {
      // A stable order, or $skip pages may overlap between requests.
      const page = await this.page(entitySet, { filter: conditions.join(' and '), ...(q.select ? { select: q.select } : {}), top: pageSize, skip, count: skip === 0, orderby: 'Ref_Key' });
      if (!page.ok) return page;
      if (skip === 0) count = page.count;
      rows.push(...page.rows);
      if (page.rows.length < pageSize || (count !== null && rows.length >= count)) break;
    }
    return { ok: true, rows: rows.slice(0, max), count };
  }

  /**
   * Creates a document (or catalogue item) with its tabular parts in ONE POST, without Ref_Key, and
   * checks that 1C answered the same number of rows per part (§8.27). Never a tabular part's own set.
   */
  async create(md: Metadata | null, entitySet: string, body: Record<string, unknown>): Promise<{ ok: true; ref: string | null; dataVersion: string | null; json: Record<string, unknown> | null } | Extract<Answer, { ok: false }>> {
    if (md && isTabularSet(md, entitySet)) return { ok: false, status: null, reason: 'onec_rows_direct', code: 13, message: `${entitySet} is a tabular part: rows go inside the document's own POST` };
    const clean = withoutKeys(body);
    const answer = await this.call('POST', `${encodeURIComponent(entitySet)}?$format=json`, clean);
    if (!answer.ok) return answer;
    const json = answer.json;
    for (const [part, rows] of Object.entries(clean)) {
      if (!Array.isArray(rows) || !json || !(part in json)) continue;
      const back = json[part];
      if (!Array.isArray(back) || back.length !== rows.length) {
        return { ok: false, status: answer.status, reason: 'rows_lost', code: null, message: `${part}: ${rows.length} sent, ${Array.isArray(back) ? back.length : 0} written` };
      }
    }
    return { ok: true, ref: typeof json?.['Ref_Key'] === 'string' ? json['Ref_Key'] : null, dataVersion: typeof json?.['DataVersion'] === 'string' ? json['DataVersion'] : null, json };
  }

  /** `Post()` on an unposted document. 1C answers 500 when its own rules refuse: that is a business refusal with 1C's words (§8.28). */
  async post(entitySet: string, ref: string): Promise<{ ok: true } | Extract<Answer, { ok: false }>> {
    const answer = await this.call('POST', `${encodeURIComponent(entitySet)}(${guid(ref)})/Post()`);
    if (answer.ok) return { ok: true };
    return answer.status === 500 ? { ...answer, reason: 'post_refused' } : answer;
  }

  /** One object's DataVersion (and the rest of it). */
  async read(entitySet: string, ref: string): Promise<{ ok: true; json: Record<string, unknown> } | Extract<Answer, { ok: false }>> {
    const answer = await this.call('GET', `${encodeURIComponent(entitySet)}(${guid(ref)})?$format=json`);
    return answer.ok ? { ok: true, json: answer.json ?? {} } : answer;
  }

  /**
   * PATCH with optimistic locking: `If-Match: <DataVersion>`; a 412 (someone saved in between) re-reads
   * the object and tries again, `attempts` times in all (§8.29). A tabular part in `changes` must be
   * complete: 1C replaces the whole part with what is sent.
   */
  async update(entitySet: string, ref: string, changes: Record<string, unknown>, attempts = 3): Promise<{ ok: true; json: Record<string, unknown> | null; attempts: number } | Extract<Answer, { ok: false }>> {
    const clean = withoutKeys(changes);
    let last: Extract<Answer, { ok: false }> | null = null;
    for (let i = 1; i <= attempts; i++) {
      const current = await this.read(entitySet, ref);
      if (!current.ok) return current;
      const version = typeof current.json['DataVersion'] === 'string' ? current.json['DataVersion'] : null;
      const answer = await this.call('PATCH', `${encodeURIComponent(entitySet)}(${guid(ref)})?$format=json`, clean, version ? { 'if-match': version } : {});
      if (answer.ok) return { ok: true, json: answer.json, attempts: i };
      last = answer;
      if (answer.status !== 412) return answer;
    }
    return last ?? { ok: false, status: null, reason: 'version_conflict', code: null, message: null };
  }

  /** "Delete" = set the deletion mark; the object stays in the base for 1C's own deletion routine (§8.30). */
  markDeleted(entitySet: string, ref: string): ReturnType<ODataClient['update']> {
    return this.update(entitySet, ref, { DeletionMark: true });
  }
}

// ── Discovery cache (§8.34) ──────────────────────────────────────────────────────────────────

const METADATA_TTL_MS = 10 * 60_000;
const metadataByBase = new Map<string, { at: number; md: Metadata }>();

/**
 * The base's $metadata, read at most once per 10 minutes per base and user and parsed once per
 * distinct document (by its SHA-256): a base whose composition changed gets a new hash and is
 * resolved again; two bases with the same composition share the parse.
 */
const parsedByHash = new Map<string, Metadata>();

export async function discover(client: ODataClient, now = Date.now()): Promise<{ ok: true; md: Metadata; cached: boolean } | Extract<Answer, { ok: false }>> {
  const key = `${client.c.baseUrl}|${client.c.username ?? ''}`;
  const held = metadataByBase.get(key);
  if (held && now - held.at < METADATA_TTL_MS) return { ok: true, md: held.md, cached: true };
  const answer = await client.metadata();
  if (!answer.ok) return answer;
  const hash = createHash('sha256').update(answer.xml).digest('hex');
  let md = parsedByHash.get(hash);
  if (!md) {
    md = parseMetadata(answer.xml);
    if (parsedByHash.size > 50) parsedByHash.clear();
    parsedByHash.set(hash, md);
  }
  metadataByBase.set(key, { at: now, md });
  return { ok: true, md, cached: false };
}

/** Forgets a base's $metadata (after a refusal that says the composition changed). */
export function forgetMetadata(client: ODataClient): void {
  metadataByBase.delete(`${client.c.baseUrl}|${client.c.username ?? ''}`);
}

/** Stores a $metadata read elsewhere (the connection test) so the next transfer does not read it again. */
export function rememberMetadata(client: ODataClient, xml: string, now = Date.now()): Metadata {
  const md = parseMetadata(xml);
  parsedByHash.set(md.hash, md);
  metadataByBase.set(`${client.c.baseUrl}|${client.c.username ?? ''}`, { at: now, md });
  return md;
}
