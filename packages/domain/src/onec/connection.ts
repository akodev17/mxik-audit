// The org's 1C settings and the optional direct connection (OneCConnection). The OData standard
// interface is the documented route (1C platform ≥ 8.3.5; 1C:Fresh publishes it at
// `<base>/odata/standard.odata/`, Basic auth, a user with «Полные права» or «УдаленныйДоступOData»:
// https://1cfresh.com/articles/data_odata, research note §2). Whether a client's Uzbek base or
// clobus.uz exposes it is unknown (research note §2 "Unknown" 4), so this connector is
// IMPLEMENTED BUT NOT VERIFIED against a real 1C: the UI and the result note say so until the
// owner's environment has been tested. The entity sets and attribute names below are the typical
// names of «Бухгалтерия для Узбекистана 3.0» (research note §2, third-party list) and are editable
// per org. No COM. The password is sealed like the 2FA secrets and never logged or answered.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { accounting } from '@tasnivo/contracts';
import { ObjectMap, ObjectTarget } from '@tasnivo/contracts/modules/onec';
import { db } from '@tasnivo/db';
import { z } from 'zod';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { derivedKey } from '../security/secret.js';
import type { ReadyTransaction } from './plan.js';

export type ConnectionKind = (typeof accounting.ONEC_CONNECTION_KINDS)[number];
export type BankKeys = (typeof accounting.ONEC_BANK_KEYS)[number];

/** One 1C object a record kind becomes (entity set, our field → 1C attribute, fixed values): the contract's shape. */
export { ObjectMap, ObjectTarget };
export type ObjectTarget = z.infer<typeof ObjectTarget>;
export type ObjectMap = z.infer<typeof ObjectMap>;

/** Typical names of the Uzbek edition (unverified; research note §2). Every org can edit them. */
export const DEFAULT_OBJECT_MAP: ObjectMap = {
  bankCredit: {
    entitySet: 'Document_ПоступлениеНаРасчетныйСчет',
    fields: { date: 'Date', number: 'НомерВходящегоДокумента', docDate: 'ДатаВходящегоДокумента', amount: 'СуммаДокумента', purpose: 'НазначениеПлатежа' },
  },
  bankDebit: {
    entitySet: 'Document_СписаниеСРасчетногоСчета',
    fields: { date: 'Date', number: 'НомерВходящегоДокумента', docDate: 'ДатаВходящегоДокумента', amount: 'СуммаДокумента', purpose: 'НазначениеПлатежа' },
  },
  invoice: {
    entitySet: 'Document_ПоступлениеТоваровУслуг',
    fields: { date: 'Date', number: 'НомерВходящегоДокумента', docDate: 'ДатаВходящегоДокумента', total: 'СуммаДокумента' },
    linesPart: 'Товары',
    lineFields: { quantity: 'Количество', price: 'Цена', amount: 'Сумма', vatAmount: 'СуммаНДС' },
  },
  product: {
    entitySet: 'Catalog_Номенклатура',
    fields: { name: 'Description', fullName: 'НаименованиеПолное' },
  },
};

// ── Sealing (AES-256-GCM, key derived from SESSION_SECRET, as security/totp.ts seals 2FA secrets) ──

const key = (): Buffer => derivedKey('onec-connection');

export function sealPassword(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

export function openPassword(sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
    if (!iv || !tag || !body) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ── Settings ───────────────────────────────────────────────────────────────────────────────

/** What the settings page shows: never the password, only whether one is stored. */
export type ConnectionView = {
  kind: ConnectionKind;
  baseUrl: string | null;
  username: string | null;
  hasPassword: boolean;
  bankKeys: BankKeys;
  objectMap: ObjectMap;
  lastTestedAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  /** Always false in this build: no real 1C has been reached by this connector yet (see the module comment). */
  verifiedAgainstReal1C: false;
};

const kindOf = (v: string): ConnectionKind => (accounting.ONEC_CONNECTION_KINDS as readonly string[]).includes(v) ? v as ConnectionKind : 'none';

export async function getConnection(orgId: string): Promise<ConnectionView> {
  const row = await db.oneCConnection.findUnique({ where: { orgId } });
  const map = ObjectMap.safeParse(row?.objectMap);
  return {
    kind: kindOf(row?.kind ?? 'none'),
    baseUrl: row?.baseUrl ?? null,
    username: row?.username ?? null,
    hasPassword: Boolean(row?.secret),
    bankKeys: row?.bankKeys === 'uz_mfo' ? 'uz_mfo' : 'standard',
    objectMap: map.success ? map.data : DEFAULT_OBJECT_MAP,
    lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
    lastOk: row?.lastOk ?? null,
    lastError: row?.lastError ?? null,
    verifiedAgainstReal1C: false,
  };
}

export const ConnectionInput = z.object({
  kind: z.enum(accounting.ONEC_CONNECTION_KINDS),
  baseUrl: z.string().trim().max(500).nullable().optional(),
  username: z.string().trim().max(200).nullable().optional(),
  /** Absent = keep the stored password; '' = remove it. */
  password: z.string().max(500).optional(),
  bankKeys: z.enum(accounting.ONEC_BANK_KEYS).optional(),
  objectMap: ObjectMap.optional(),
});
export type ConnectionInput = z.infer<typeof ConnectionInput>;

/** An http(s) URL without credentials, query or fragment, trailing slashes trimmed; null otherwise. */
export function cleanBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return url.toString().replace(/\/+$/, '');
}

export type SaveResult = { ok: true; connection: ConnectionView } | { ok: false; error: 'bad_url' | 'url_required' | 'invalid' };

export async function saveConnection(orgId: string, actorId: string, body: unknown): Promise<SaveResult> {
  const parsed = ConnectionInput.safeParse(body);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const input = parsed.data;
  let baseUrl: string | null = null;
  if (input.baseUrl) {
    baseUrl = cleanBaseUrl(input.baseUrl);
    if (!baseUrl) return { ok: false, error: 'bad_url' };
  }
  if (input.kind !== 'none' && !baseUrl) return { ok: false, error: 'url_required' };
  const secret = input.password === undefined ? undefined : input.password === '' ? null : sealPassword(input.password);
  const data = {
    kind: input.kind, baseUrl, username: input.username || null, updatedBy: actorId,
    ...(secret !== undefined ? { secret } : {}),
    ...(input.bankKeys ? { bankKeys: input.bankKeys } : {}),
    ...(input.objectMap ? { objectMap: input.objectMap } : {}),
  };
  const before = await db.oneCConnection.findUnique({ where: { orgId }, select: { baseUrl: true, username: true } });
  const changedTarget = !before || before.baseUrl !== baseUrl || before.username !== (input.username || null) || secret !== undefined;
  await db.oneCConnection.upsert({
    where: { orgId },
    create: { orgId, ...data },
    // A new address or credentials forget the last test's verdict.
    update: { ...data, ...(changedTarget ? { lastTestedAt: null, lastOk: null, lastError: null } : {}) },
  });
  await db.auditEvent.create({ data: { orgId, actorId, action: 'onec.connection_saved', targetId: null, payload: { kind: input.kind, bankKeys: input.bankKeys ?? null } } });
  return { ok: true, connection: await getConnection(orgId) };
}

// ── Talking to 1C ──────────────────────────────────────────────────────────────────────────

export const REQUEST_TIMEOUT_MS = 10_000;

/** A dotted, shorthand, octal, hex or decimal IPv4 literal (127.0.0.1, 127.1, 0177.0.0.1, 0x7f000001, 2130706433) as its four octets; null when it is not one. */
function ipv4Octets(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length > 4 || parts.some((p) => p === '')) return null;
  const values: number[] = [];
  for (const p of parts) {
    if (!/^(0x[0-9a-f]+|0[0-7]*|[1-9]\d*)$/i.test(p)) return null;
    values.push(/^0x/i.test(p) ? parseInt(p, 16) : p.length > 1 && p.startsWith('0') ? parseInt(p, 8) : Number(p));
  }
  // The last part fills the remaining octets, as inet_aton reads it (127.1 is 127.0.0.1).
  const last = values.pop() ?? 0;
  const fill = 4 - values.length;
  if (values.some((v) => v > 255) || last >= 256 ** fill) return null;
  for (let i = fill - 1; i >= 0; i--) values.push(Math.floor(last / 256 ** i) % 256);
  return values;
}

/** An IPv6 literal as eight hextets, or null. A dotted IPv4 tail (::ffff:127.0.0.1) becomes its two hextets. */
function ipv6Hextets(host: string): number[] | null {
  let s = host.toLowerCase().replace(/%.*$/, '');
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const v4 = ipv4Octets(dotted[2] ?? '');
    if (!v4) return null;
    s = `${dotted[1]}${(((v4[0] ?? 0) << 8) | (v4[1] ?? 0)).toString(16)}:${(((v4[2] ?? 0) << 8) | (v4[3] ?? 0)).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const hextets = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const h of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };
  const head = hextets(halves[0] ?? '');
  const tail = halves.length === 2 ? hextets(halves[1] ?? '') : [];
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

const privateV4 = ([a = 0, b = 0]: number[]): boolean =>
  a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);

/**
 * Loopback, unspecified, private, link-local, carrier-grade NAT and unique-local addresses, in every
 * spelling: dotted, shorthand, octal, hex or decimal IPv4, and IPv4 carried in IPv6 (IPv4-mapped
 * `::ffff:127.0.0.1` or `::ffff:7f00:1` as `new URL()` writes it, IPv4-compatible `::127.0.0.1`,
 * NAT64 `64:ff9b::7f00:1`), with or without brackets. What is not an address counts as private
 * (Phase C F3: the dotted-only check let `[::ffff:7f00:1]` through). Refused in production unless allowed.
 */
export function privateAddress(ip: string): boolean {
  const host = ip.trim().replace(/^\[|\]$/g, '');
  const v4 = ipv4Octets(host);
  if (v4) return privateV4(v4);
  const v6 = ipv6Hextets(host);
  if (!v6) return true;
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = v6;
  const zeroPrefix = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0;
  const carriesV4 = (zeroPrefix && (h5 === 0xffff || h5 === 0)) || (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0);
  if (carriesV4) return privateV4([h6 >> 8, h6 & 0xff, h7 >> 8, h7 & 0xff]);
  return (h0 & 0xfe00) === 0xfc00 || (h0 & 0xffc0) === 0xfe80;
}

/**
 * Whether the server may call this host. A SaaS must not become a proxy into its own network: in
 * production a host that resolves to a private address is refused unless ONEC_ALLOW_PRIVATE_HOSTS=1
 * (a self-hosted install next to the client's 1C). Development and tests allow it.
 */
export async function hostAllowed(baseUrl: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (env['NODE_ENV'] !== 'production' || env['ONEC_ALLOW_PRIVATE_HOSTS'] === '1') return true;
  const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
  try {
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((a) => !privateAddress(a.address));
  } catch {
    return false;
  }
}

type Credentials = { baseUrl: string; username: string | null; password: string | null };

const authHeader = (c: Credentials): Record<string, string> =>
  c.username ? { authorization: `Basic ${Buffer.from(`${c.username}:${c.password ?? ''}`, 'utf8').toString('base64')}` } : {};

export const odataRoot = (baseUrl: string): string => `${baseUrl}/odata/standard.odata`;

/** A failure in words safe to store and show: the status or the network error's kind, never a header or a password. */
function failure(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'timeout';
  const code = (error as { cause?: { code?: string } })?.cause?.code;
  return code ? `unreachable:${code}` : 'unreachable';
}

export type TestResult = {
  ok: boolean;
  /** HTTP status when the server answered. */
  status: number | null;
  /** `ok`, `auth_failed`, `not_found`, `http_<status>`, `timeout`, `unreachable[:code]`, `no_url`, `host_refused`, `not_odata`. */
  code: string;
  /** Entity sets the $metadata lists, and the configured ones it lacks (OData only). */
  entitySets: number | null;
  missing: string[];
  testedAt: string;
};

async function credentialsOf(orgId: string): Promise<(Credentials & { kind: ConnectionKind; objectMap: ObjectMap }) | null> {
  const row = await db.oneCConnection.findUnique({ where: { orgId } });
  if (!row?.baseUrl) return null;
  const map = ObjectMap.safeParse(row.objectMap);
  return {
    kind: kindOf(row.kind), baseUrl: row.baseUrl, username: row.username, password: row.secret ? openPassword(row.secret) : null,
    objectMap: map.success ? map.data : DEFAULT_OBJECT_MAP,
  };
}

/**
 * `POST /api/onec/connection/test`: GET `<base>/odata/standard.odata/$metadata` (odata) or the base
 * URL (http) with Basic auth and a 10 s timeout; stores the verdict on the connection.
 */
export async function testConnection(orgId: string, fetcher: typeof fetch = fetch): Promise<TestResult> {
  const testedAt = new Date();
  const c = await credentialsOf(orgId);
  const done = async (result: Omit<TestResult, 'testedAt'>): Promise<TestResult> => {
    if (c) await db.oneCConnection.update({ where: { orgId }, data: { lastTestedAt: testedAt, lastOk: result.ok, lastError: result.ok ? null : result.code } });
    return { ...result, testedAt: testedAt.toISOString() };
  };
  if (!c || c.kind === 'none') return done({ ok: false, status: null, code: 'no_url', entitySets: null, missing: [] });
  if (!(await hostAllowed(c.baseUrl))) return done({ ok: false, status: null, code: 'host_refused', entitySets: null, missing: [] });
  const url = c.kind === 'odata' ? `${odataRoot(c.baseUrl)}/$metadata` : c.baseUrl;
  let res: Response;
  try {
    res = await fetcher(url, { method: 'GET', headers: { ...authHeader(c), accept: 'application/xml, application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'manual' });
  } catch (error) {
    return done({ ok: false, status: null, code: failure(error), entitySets: null, missing: [] });
  }
  if (res.status === 401 || res.status === 403) return done({ ok: false, status: res.status, code: 'auth_failed', entitySets: null, missing: [] });
  if (res.status === 404) return done({ ok: false, status: res.status, code: 'not_found', entitySets: null, missing: [] });
  if (res.status < 200 || res.status >= 300) return done({ ok: false, status: res.status, code: `http_${res.status}`, entitySets: null, missing: [] });
  if (c.kind !== 'odata') return done({ ok: true, status: res.status, code: 'ok', entitySets: null, missing: [] });
  const text = (await res.text()).slice(0, 5_000_000);
  const sets = new Set([...text.matchAll(/<EntitySet\s+Name="([^"]+)"/g)].map((m) => m[1] ?? ''));
  if (sets.size === 0) return done({ ok: false, status: res.status, code: 'not_odata', entitySets: 0, missing: [] });
  const wanted = Object.values(c.objectMap).map((t) => t.entitySet);
  const missing = [...new Set(wanted.filter((s) => !sets.has(s)))];
  return done({ ok: true, status: res.status, code: 'ok', entitySets: sets.size, missing });
}

// ── Documents for the OData transfer (pure) ───────────────────────────────────────────────

type InvoiceLine = z.infer<typeof accounting.InvoiceLine>;
type IncomingInvoiceMeta = z.infer<typeof accounting.IncomingInvoiceMeta>;
type ProductRecord = z.infer<typeof accounting.ProductRecord>;

const odataDate = (iso: string): string => `${iso}T00:00:00`;
const number = (text: string | null): number | null => (text === null ? null : Number(text));

function mapped(target: ObjectTarget, values: Record<string, string | number | null>): Record<string, unknown> {
  const body: Record<string, unknown> = { ...(target.constants ?? {}) };
  for (const [ours, theirs] of Object.entries(target.fields)) {
    const v = values[ours];
    if (v !== undefined && v !== null && theirs) body[theirs] = v;
  }
  return body;
}

export function bankDocument(map: ObjectMap, t: ReadyTransaction): { entitySet: string; body: Record<string, unknown> } {
  const target = t.direction === 'credit' ? map.bankCredit : map.bankDebit;
  return {
    entitySet: target.entitySet,
    body: mapped(target, {
      date: odataDate(t.valueDate ?? t.date), docDate: odataDate(t.date), number: t.docNumber, amount: number(t.amount), purpose: t.purpose,
      counterpartyName: t.counterparty.name, counterpartyInn: t.counterparty.inn, counterpartyAccount: t.counterparty.account, operation: t.operation,
    }),
  };
}

export function productDocument(map: ObjectMap, p: ProductRecord): { entitySet: string; body: Record<string, unknown> } {
  return {
    entitySet: map.product.entitySet,
    body: mapped(map.product, { name: p.name, fullName: p.name, mxik: p.mxik, packageCode: p.packageCode, unit: p.unit, barcode: p.barcode }),
  };
}

export function invoiceDocument(map: ObjectMap, meta: IncomingInvoiceMeta, lines: readonly InvoiceLine[]): { entitySet: string; body: Record<string, unknown> } {
  const target = map.invoice;
  const body = mapped(target, {
    date: odataDate(meta.date), docDate: odataDate(meta.date), number: meta.number, total: number(meta.totalWithVat), amount: number(meta.totalAmount),
    vat: number(meta.totalVat), sellerName: meta.seller.name, sellerInn: meta.seller.inn, contractNumber: meta.contractNumber,
  });
  if (target.linesPart && target.lineFields) {
    const fields = target.lineFields;
    body[target.linesPart] = lines.map((l, i) => {
      const row: Record<string, unknown> = { LineNumber: String(i + 1) };
      const values: Record<string, string | number | null> = {
        name: l.resolved?.name ?? l.name, mxik: l.resolved?.mxik ?? l.mxik, quantity: number(l.quantity), price: number(l.price), amount: number(l.amount),
        vatRate: l.vatRate, vatAmount: number(l.vatAmount), total: number(l.total),
      };
      for (const [ours, theirs] of Object.entries(fields)) if (values[ours] !== null && values[ours] !== undefined) row[theirs] = values[ours];
      return row;
    });
  }
  return { entitySet: target.entitySet, body };
}

export type PostResult = { ok: true; ref: string | null } | { ok: false; reason: string; message: string | null };

/** POST one document to `<base>/odata/standard.odata/<entitySet>?$format=json`. */
export async function postDocument(c: Credentials, entitySet: string, body: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetcher(`${odataRoot(c.baseUrl)}/${encodeURIComponent(entitySet)}?$format=json`, {
      method: 'POST',
      headers: { ...authHeader(c), 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'manual',
    });
  } catch (error) {
    return { ok: false, reason: failure(error), message: null };
  }
  const text = await res.text().catch(() => '');
  if (res.status >= 200 && res.status < 300) {
    const ref = /"Ref_Key"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? null;
    return { ok: true, ref };
  }
  // 1C's OData error body: {"odata.error":{"code":"…","message":{"lang":"ru","value":"…"}}}.
  const message = /"value"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1] ?? null;
  return { ok: false, reason: res.status === 401 || res.status === 403 ? 'auth_failed' : 'onec_refused', message: message ? message.replace(/\\"/g, '"').slice(0, 1000) : `HTTP ${res.status}` };
}

export { credentialsOf };
