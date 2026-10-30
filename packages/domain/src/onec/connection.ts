// The org's 1C settings and the optional direct connection (OneCConnection). The OData standard
// interface is the documented route (1C platform ≥ 8.3.5; 1C:Fresh publishes it at
// `<base>/odata/standard.odata/`, Basic auth, a user with «Полные права» or «УдаленныйДоступOData»:
// https://1cfresh.com/articles/data_odata, research note §2). Whether a client's Uzbek base or
// clobus.uz exposes it is unknown (research note §2 "Unknown" 4), so this connector is
// IMPLEMENTED BUT NOT VERIFIED against a real 1C: the UI and the result note say so until the
// owner's environment has been tested. The entity sets and attribute names below are the typical
// names of «Бухгалтерия для Узбекистана 3.0» (research note §2, third-party list) and are editable
// per org. No COM. The password is sealed like the 2FA secrets and never logged or answered.
import { accounting } from '@tasnivo/contracts';
import { CompositionProblem as CompositionProblemSchema, ObjectMap, ObjectTarget, RefTarget as RefTargetSchema } from '@tasnivo/contracts/modules/onec';
import { db } from '@tasnivo/db';
import { z } from 'zod';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { derivedKey } from '../security/secret.js';
import { fromMicros, money2, toMicros } from './decimal.js';
import { hostFetcher } from './host-guard.js';
import { bodyDate, networkFailure, ODataClient, rememberMetadata, REQUEST_TIMEOUT_MS, type Metadata, type ODataCredentials } from './odata.js';
import type { ReadyTransaction } from './plan.js';

export type ConnectionKind = (typeof accounting.ONEC_CONNECTION_KINDS)[number];
export type BankKeys = (typeof accounting.ONEC_BANK_KEYS)[number];

/** One 1C object a record kind becomes (entity set, our field → 1C attribute, fixed values): the contract's shape. */
export { ObjectMap, ObjectTarget };
export type ObjectTarget = z.infer<typeof ObjectTarget>;
export type ObjectMap = z.infer<typeof ObjectMap>;

/** The references every bank document carries: the counterparty by ИНН, its contract, the ДДС item, our account. */
const BANK_REFS: NonNullable<ObjectTarget['refs']> = {
  counterparty: { attribute: 'Контрагент', entitySet: 'Catalog_Контрагенты', key: 'ИНН' },
  contract: { attribute: 'ДоговорКонтрагента', entitySet: 'Catalog_ДоговорыКонтрагентов', key: 'Description', owner: 'counterparty' },
  cashFlowItem: { attribute: 'СтатьяДвиженияДенежныхСредств', entitySet: 'Catalog_СтатьиДвиженияДенежныхСредств', key: 'Description' },
  ourAccount: { attribute: 'СчетОрганизации', entitySet: 'Catalog_БанковскиеСчета', key: 'НомерСчета' },
};
const BANK_FIELDS = {
  date: 'Date', number: 'НомерВходящегоДокумента', docDate: 'ДатаВходящегоДокумента', amount: 'СуммаДокумента', purpose: 'НазначениеПлатежа',
  operation: 'ВидОперации', comment: 'Комментарий',
};

/**
 * Typical names of the Uzbek edition (BP 3.0 family; unverified against a real UZ base, research
 * note onec §5.2). Every org can edit them; the entity sets are looked up in the base's $metadata,
 * alternatives included, before anything is written. B4: the operation chosen in review goes to
 * ВидОперации (an enumeration, written by value name), the ДДС item, the contract and the
 * counterparty are found in the base and written as references.
 */
export const DEFAULT_OBJECT_MAP: ObjectMap = {
  bankCredit: {
    entitySet: 'Document_ПоступлениеНаРасчетныйСчет',
    fields: BANK_FIELDS,
    values: {
      operation: {
        payment_in: 'ОплатаПокупателя', acquiring: 'ПоступленияОтПродажПоПлатежнымКартамИБанковскимКредитам', transfer: 'ПереводСДругогоСчета',
        loan: 'ПолучениеКредита', other_in: 'ПрочееПоступление',
      },
    },
    refs: BANK_REFS,
  },
  bankDebit: {
    entitySet: 'Document_СписаниеСРасчетногоСчета',
    fields: BANK_FIELDS,
    values: {
      operation: {
        payment_out: 'ОплатаПоставщику', tax: 'ПеречислениеНалога', salary: 'ПеречислениеЗаработнойПлаты', bank_fee: 'ПрочееСписание',
        transfer: 'ПереводНаДругойСчет', loan: 'ВозвратКредита', other_out: 'ПрочееСписание',
      },
    },
    refs: BANK_REFS,
  },
  invoice: {
    entitySet: 'Document_ПоступлениеТоваровУслуг',
    fields: { date: 'Date', number: 'НомерВходящегоДокумента', docDate: 'ДатаВходящегоДокумента', total: 'СуммаДокумента', comment: 'Комментарий' },
    refs: {
      counterparty: { attribute: 'Контрагент', entitySet: 'Catalog_Контрагенты', key: 'ИНН' },
      contract: { attribute: 'ДоговорКонтрагента', entitySet: 'Catalog_ДоговорыКонтрагентов', key: 'Description', owner: 'counterparty' },
    },
    linesPart: 'Товары',
    lineFields: { quantity: 'Количество', price: 'Цена', amount: 'Сумма', vatRate: 'СтавкаНДС', vatAmount: 'СуммаНДС' },
    values: {
      vatRate: { '0': 'НДС0', '12': 'НДС12', '15': 'НДС15', none: 'БезНДС' },
      // 1C UZ 3.0.60.12: VAT of a high-risk ЭСФ is booked on 4410.11.
      vatAccount: { high: '4410.11' },
    },
    lineRefs: {
      product: { attribute: 'Номенклатура', entitySet: 'Catalog_Номенклатура', key: 'Description' },
      vatAccount: { attribute: 'СчетУчетаНДС', entitySet: 'ChartOfAccounts_Хозрасчетный', key: 'Code' },
    },
    marksPart: 'КодыМаркировки',
    marksFields: { line: 'НомерСтрокиТовары', code: 'КодМаркировки' },
  },
  product: {
    entitySet: 'Catalog_Номенклатура',
    fields: { name: 'Description', fullName: 'НаименованиеПолное', article: 'Артикул' },
    refs: {
      // RU BP 3.0 names it КлассификаторЕдиницИзмерения, other editions ЕдиницыИзмерения: discovered, never assumed (§8.34).
      unit: { attribute: 'ЕдиницаИзмерения', entitySet: 'Catalog_КлассификаторЕдиницИзмерения', alternatives: ['Catalog_ЕдиницыИзмерения'], key: 'Description' },
    },
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

// The OData client itself (what a real base expects, §8.25–34): odata.ts.
export { odataRoot, REQUEST_TIMEOUT_MS } from './odata.js';

// Which hosts may be called, and the fetch pinned to the checked address: host-guard.ts (F20).
export { hostAllowed, hostFetcher, privateAddress } from './host-guard.js';

export type CompositionProblem = z.infer<typeof CompositionProblemSchema>;

export type TestResult = {
  ok: boolean;
  /** HTTP status when the server answered. */
  status: number | null;
  /** `ok`, `auth_failed`, `not_found`, `redirected`, `http_<status>`, `timeout`, `unreachable[:code]`, `no_url`, `host_refused`, `not_odata`. */
  code: string;
  /** Entity sets the $metadata lists, and the configured ones it lacks (OData only). */
  entitySets: number | null;
  missing: string[];
  /** Everything the composition lacks for the object map, each named (onec §8.25). */
  problems: CompositionProblem[];
  /** Our entity set name → the one this base uses, where an alternative was found (§8.34). */
  resolved: Record<string, string>;
  /** Plain http: the Basic credentials cross the network unencrypted (§8.26). */
  insecure: boolean;
  testedAt: string;
};

async function credentialsOf(orgId: string): Promise<(ODataCredentials & { kind: ConnectionKind; objectMap: ObjectMap }) | null> {
  const row = await db.oneCConnection.findUnique({ where: { orgId } });
  if (!row?.baseUrl) return null;
  const map = ObjectMap.safeParse(row.objectMap);
  return {
    kind: kindOf(row.kind), baseUrl: row.baseUrl, username: row.username, password: row.secret ? openPassword(row.secret) : null,
    objectMap: map.success ? map.data : DEFAULT_OBJECT_MAP,
  };
}

/** The test's word for a refused $metadata read. */
function metadataCode(status: number | null, reason: string): string {
  if (status === null) return reason;
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 404) return 'not_found';
  if (status >= 300 && status < 400) return 'redirected';
  return `http_${status}`;
}

/**
 * `POST /api/onec/connection/test`: GET `<base>/odata/standard.odata/$metadata` (odata) or the base
 * URL (http) with Basic auth and a 10 s timeout, no redirects followed; the object map is resolved
 * against the $metadata (kept for the next transfer) and every gap is listed. Stores the verdict.
 */
export async function testConnection(orgId: string, fetcher?: typeof fetch): Promise<TestResult> {
  const testedAt = new Date();
  const c = await credentialsOf(orgId);
  const insecure = Boolean(c?.baseUrl.startsWith('http:'));
  const done = async (result: Omit<TestResult, 'testedAt' | 'problems' | 'resolved' | 'insecure'> & Partial<Pick<TestResult, 'problems' | 'resolved'>>): Promise<TestResult> => {
    if (c) await db.oneCConnection.update({ where: { orgId }, data: { lastTestedAt: testedAt, lastOk: result.ok, lastError: result.ok ? null : result.code } });
    return { problems: [], resolved: {}, ...result, insecure, testedAt: testedAt.toISOString() };
  };
  if (!c || c.kind === 'none') return done({ ok: false, status: null, code: 'no_url', entitySets: null, missing: [] });
  // The checked address is the one connected to (no second DNS answer between the check and the call).
  const pinned = await hostFetcher(c.baseUrl);
  if (!pinned) return done({ ok: false, status: null, code: 'host_refused', entitySets: null, missing: [] });
  if (c.kind !== 'odata') {
    let res: Response;
    try {
      const auth: Record<string, string> = c.username ? { authorization: `Basic ${Buffer.from(`${c.username}:${c.password ?? ''}`, 'utf8').toString('base64')}` } : {};
      res = await (fetcher ?? pinned)(c.baseUrl, { method: 'GET', headers: { ...auth, accept: 'application/xml, application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'manual' });
    } catch (error) {
      return done({ ok: false, status: null, code: networkFailure(error), entitySets: null, missing: [] });
    }
    await res.body?.cancel().catch(() => undefined);
    if (res.status < 200 || res.status >= 300) return done({ ok: false, status: res.status, code: metadataCode(res.status, ''), entitySets: null, missing: [] });
    return done({ ok: true, status: res.status, code: 'ok', entitySets: null, missing: [] });
  }
  const client = new ODataClient(c, fetcher ?? pinned);
  const answer = await client.metadata();
  if (!answer.ok) return done({ ok: false, status: answer.status, code: metadataCode(answer.status, answer.reason), entitySets: null, missing: [] });
  const md = rememberMetadata(client, answer.xml);
  if (md.sets.size === 0) return done({ ok: false, status: 200, code: 'not_odata', entitySets: 0, missing: [] });
  const r = resolveMap(c.objectMap, md);
  const missing = [...new Set(r.problems.filter((p) => p.kind === 'set_missing').map((p) => p.entitySet))];
  return done({ ok: true, status: 200, code: 'ok', entitySets: md.sets.size, missing, problems: r.problems, resolved: r.renamed });
}

// ── The object map against the base's $metadata (§8.25, §8.34) ──────────────────────────────

export type TargetKey = keyof ObjectMap;
const TARGETS: readonly TargetKey[] = ['bankCredit', 'bankDebit', 'invoice', 'product'];

const pickSet = (md: Metadata, name: string, alternatives: readonly string[] = []): string | null =>
  [name, ...alternatives].find((n) => md.sets.has(n)) ?? null;

export type Resolution = { map: ObjectMap; problems: CompositionProblem[]; renamed: Record<string, string> };

/**
 * The object map as this base names it: each entity set (or its first listed alternative) found in
 * the $metadata, and every set, attribute and tabular part it lacks named. A missing document set,
 * attribute or tabular part is `required` (1C ignores unknown properties, so writing anyway would
 * lose data silently); a missing reference catalogue only leaves that reference empty.
 */
export function resolveMap(map: ObjectMap, md: Metadata): Resolution {
  const problems: CompositionProblem[] = [];
  const renamed: Record<string, string> = {};
  const out = structuredClone(map);
  const add = (p: CompositionProblem): void => {
    if (!problems.some((q) => q.kind === p.kind && q.entitySet === p.entitySet && q.attribute === p.attribute)) problems.push(p);
  };
  for (const key of TARGETS) {
    const t = out[key];
    const set = pickSet(md, t.entitySet, t.alternatives);
    if (!set) {
      add({ kind: 'set_missing', target: key, entitySet: t.entitySet, required: true });
      continue;
    }
    if (set !== t.entitySet) renamed[t.entitySet] = set;
    t.entitySet = set;
    const shape = md.sets.get(set);
    const typed = Boolean(shape?.typed);
    if (shape && typed) {
      for (const attr of [...Object.values(t.fields), ...Object.keys(t.constants ?? {})]) {
        if (!shape.properties.has(attr)) add({ kind: 'attribute_missing', target: key, entitySet: set, attribute: attr, required: true });
      }
      if (t.linesPart) {
        const row = shape.parts.get(t.linesPart);
        if (!row) add({ kind: 'part_missing', target: key, entitySet: set, attribute: t.linesPart, required: true });
        else for (const attr of Object.values(t.lineFields ?? {})) if (!row.has(attr)) add({ kind: 'attribute_missing', target: key, entitySet: set, attribute: `${t.linesPart}.${attr}`, required: true });
      }
      if (t.marksPart && !shape.parts.has(t.marksPart)) add({ kind: 'part_missing', target: key, entitySet: set, attribute: t.marksPart, required: false });
    }
    const groups: [Record<string, RefTarget> | undefined, string | null][] = [[t.refs, null], [t.lineRefs, t.linesPart ?? null]];
    for (const [refs, part] of groups) {
      for (const r of Object.values(refs ?? {})) {
        const found = pickSet(md, r.entitySet, r.alternatives);
        if (!found) add({ kind: 'ref_missing', target: key, entitySet: r.entitySet, attribute: r.attribute, required: false });
        else {
          if (found !== r.entitySet) renamed[r.entitySet] = found;
          r.entitySet = found;
        }
        const props = shape && typed ? (part ? shape.parts.get(part) : shape.properties) : undefined;
        if (props && !props.has(`${r.attribute}_Key`) && !props.has(r.attribute)) {
          add({ kind: 'attribute_missing', target: key, entitySet: set, attribute: part ? `${part}.${r.attribute}` : r.attribute, required: false });
        }
      }
    }
  }
  return { map: out, problems, renamed };
}

// ── Documents for the OData transfer (pure) ───────────────────────────────────────────────

type InvoiceLine = z.infer<typeof accounting.InvoiceLine>;
type IncomingInvoiceMeta = z.infer<typeof accounting.IncomingInvoiceMeta>;
type ProductRecord = z.infer<typeof accounting.ProductRecord>;
export type RefTarget = z.infer<typeof RefTargetSchema>;

/** A reference to find before writing: in the document's header (`line` null) or on one goods line. */
export type RefNeed = { name: string; ref: RefTarget; value: string; line: number | null };
export type DocumentJob = { entitySet: string; body: Record<string, unknown>; needs: RefNeed[]; notes: string[] };

/** Count with 6 decimals, money with 2 (the ЭСФ's own precision, onec §8.37), as JSON numbers. */
const qty6 = (text: string | null): number | null => {
  const m = text === null ? null : toMicros(text);
  return m === null || m === undefined ? null : Number(fromMicros(m));
};
const sum2 = (text: string | null): number | null => (text === null || toMicros(text) === null ? null : Number(money2(text)));

/** Our value through the target's value map: unmapped values of a mapped field are not sent. */
function through(t: ObjectTarget, field: string, value: string | number | null): string | number | null {
  const table = t.values?.[field];
  if (value === null || !table) return value;
  return table[String(value)] ?? null;
}

function mapped(t: ObjectTarget, fields: Record<string, string>, values: Record<string, string | number | null>, notes: string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [ours, theirs] of Object.entries(fields)) {
    const raw = values[ours];
    if (raw === undefined || raw === null || !theirs) continue;
    const v = through(t, ours, raw);
    if (v === null) notes.push(`${ours}_unmapped:${raw}`);
    else body[theirs] = v;
  }
  return body;
}

const need = (t: ObjectTarget, name: string, value: string | null | undefined, line: number | null = null, refs = line === null ? t.refs : t.lineRefs): RefNeed[] => {
  const ref = refs?.[name];
  return ref && value ? [{ name, ref, value, line }] : [];
};

export function bankDocument(map: ObjectMap, t: ReadyTransaction): DocumentJob {
  const target = t.direction === 'credit' ? map.bankCredit : map.bankDebit;
  const notes: string[] = [];
  const body = {
    ...(target.constants ?? {}),
    ...mapped(target, target.fields, {
      date: bodyDate(t.valueDate ?? t.date), docDate: bodyDate(t.date), number: t.docNumber, amount: sum2(t.amount), purpose: t.purpose,
      operation: t.operation, comment: `Tasnivo${t.docNumber ? `: ${t.docNumber}` : ''}`,
      counterpartyName: t.counterparty.name, counterpartyInn: t.counterparty.inn, counterpartyAccount: t.counterparty.account,
    }, notes),
  };
  if (t.operation === null && target.fields['operation']) notes.push('operation_missing');
  const needs = [
    ...need(target, 'counterparty', t.counterparty.inn), ...need(target, 'contract', t.contract),
    ...need(target, 'cashFlowItem', t.cashFlowItem), ...need(target, 'ourAccount', t.ourAccount),
  ];
  return { entitySet: target.entitySet, body, needs, notes };
}

export function productDocument(map: ObjectMap, p: ProductRecord): DocumentJob {
  const notes: string[] = [];
  const values = { name: p.name, fullName: p.name, article: p.article ?? null, mxik: p.mxik, packageCode: p.packageCode, barcode: p.barcode };
  const body = {
    ...(map.product.constants ?? {}),
    ...mapped(map.product, map.product.fields, values, notes),
  };
  // A code the product has but the map sends nowhere (the default map has no ИКПУ attribute: its name in a UZ base is
  // not known yet) is said on the record, not dropped silently (onec §8.2, review 30 Oct).
  for (const k of ['mxik', 'packageCode', 'barcode'] as const) if (values[k] && !map.product.fields[k]) notes.push(`${k}_not_sent`);
  return { entitySet: map.product.entitySet, body, needs: need(map.product, 'unit', p.unit), notes };
}

/** A VAT rate as the value map's key: `12`, `0`, `none` (without VAT). */
const rateKey = (rate: string | null): string => (rate === null || rate.trim() === '' ? 'none' : String(Number(rate)));

/**
 * The receipt of an incoming ЭСФ with its goods in ONE document (onec §8.27): count with 6
 * decimals, money with 2, the header total from the document itself when every line goes (not
 * re-added from the lines, §8.37), marking codes kept per line (§8.38), and a high-risk ЭСФ's VAT on
 * the account 1C UZ uses for it (§8.36).
 */
export function invoiceDocument(map: ObjectMap, meta: IncomingInvoiceMeta, lines: readonly InvoiceLine[], whole = true): DocumentJob {
  const target = map.invoice;
  const notes: string[] = [];
  const high = meta.riskLevel === 'high';
  const lineTotal = (l: InvoiceLine): bigint => (l.total !== null ? toMicros(l.total) ?? 0n : (toMicros(l.amount) ?? 0n) + (toMicros(l.vatAmount) ?? 0n));
  const total = whole ? meta.totalWithVat : fromMicros(lines.reduce((s, l) => s + lineTotal(l), 0n));
  if (!whole) notes.push('partial_document');
  const comment = [`ЭСФ ${meta.number} от ${meta.date}`, meta.facturaType ? `тип ${meta.facturaType}` : null, high ? 'высокий уровень риска' : null].filter(Boolean).join('; ');
  const body: Record<string, unknown> = {
    ...(target.constants ?? {}),
    ...mapped(target, target.fields, {
      date: bodyDate(meta.date), docDate: bodyDate(meta.date), number: meta.number, total: sum2(total), amount: sum2(meta.totalAmount),
      vat: sum2(meta.totalVat), comment, sellerName: meta.seller.name, sellerInn: meta.seller.inn, contractNumber: meta.contractNumber,
    }, notes),
  };
  const needs: RefNeed[] = [...need(target, 'counterparty', meta.seller.inn), ...need(target, 'contract', meta.contractNumber)];
  if (target.linesPart && target.lineFields) {
    const fields = target.lineFields;
    body[target.linesPart] = lines.map((l, i) => {
      // LineNumber as a string, as 1C writes it (§8.33).
      const row: Record<string, unknown> = { LineNumber: String(i + 1) };
      Object.assign(row, mapped(target, fields, {
        name: l.resolved?.name ?? l.name, mxik: l.resolved?.mxik ?? l.mxik, quantity: qty6(l.quantity), price: sum2(l.price), amount: sum2(l.amount),
        vatRate: rateKey(l.vatRate), vatAmount: sum2(l.vatAmount), total: sum2(l.total),
      }, notes));
      needs.push(...need(target, 'product', l.resolved?.name || l.name, i), ...(high ? need(target, 'vatAccount', String(through(target, 'vatAccount', 'high') ?? ''), i) : []));
      return row;
    });
  }
  const marks = lines.flatMap((l, i) => (l.markingCodes ?? []).map((code) => ({ line: i + 1, code })));
  if (marks.length > 0 && target.marksPart && target.marksFields) {
    const f = target.marksFields;
    body[target.marksPart] = marks.map((m, i) => ({ LineNumber: String(i + 1), [f.line]: String(m.line), [f.code]: m.code }));
  } else if (marks.length > 0) notes.push('marks_not_mapped');
  return { entitySet: target.entitySet, body, needs, notes };
}

/** Where a found reference is written: `X_Key` for a plain one, `X` + `X_Type` for a composite one (§8.32). */
export function writeRef(md: Metadata | null, job: DocumentJob, linesPart: string | undefined, n: RefNeed, key: string): boolean {
  const shape = md?.sets.get(job.entitySet);
  const props = shape?.typed ? (n.line === null ? shape.properties : linesPart ? shape.parts.get(linesPart) : undefined) : undefined;
  const into = n.line === null ? job.body : ((job.body[linesPart ?? ''] as Record<string, unknown>[] | undefined)?.[n.line]);
  if (!into) return false;
  const a = n.ref.attribute;
  if (!props || props.has(`${a}_Key`)) into[`${a}_Key`] = key;
  else if (props.has(a) && props.has(`${a}_Type`)) {
    into[a] = key;
    into[`${a}_Type`] = `StandardODATA.${n.ref.entitySet}`;
  } else return false;
  return true;
}

export { credentialsOf };
