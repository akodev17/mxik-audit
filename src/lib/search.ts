// Global search behind the command palette: clients, catalogues, products of each visible
// client's latest audited catalogue, and classifier codes. Every query is scoped to the user.
import type { CatalogStatus, Prisma, Severity, Decision, FindingType } from '@prisma/client';
import { matchKeyOf } from '../core/normalize/index.js';
import { catalogScope, clientScope } from './access.js';
import { db } from './db.js';
import type { Locale } from './i18n.js';
import type { CurrentUser } from './session.js';

export type SearchUser = Pick<CurrentUser, 'orgId' | 'clientIds'>;

/** attention: a risky finding still pending; decided: every risky finding decided; info: only informational findings; clean: nothing detected. */
export type ProductStatus = 'attention' | 'decided' | 'info' | 'clean';

export type ClientHit = { id: string; name: string; href: string };
export type CatalogHit = { id: string; filename: string; clientName: string | null; createdAt: Date; status: CatalogStatus; href: string };
export type ProductHit = { id: string; name: string; code: string | null; row: number; clientName: string | null; status: ProductStatus; href: string };
export type CodeHit = { code: string; name: string; retired: boolean };

export type SearchResults = { query: string; clients: ClientHit[]; catalogs: CatalogHit[]; products: ProductHit[]; codes: CodeHit[] };

export const MIN_TEXT = 2;
export const MIN_CODE_DIGITS = 5;
const MAX_QUERY = 100;
const LIMITS = { clients: 5, catalogs: 5, products: 8, codes: 5 } as const;

export type ParsedQuery = { text: string; digits: string | null; tooShort: boolean };

/** Trimmed text, plus the digits when the query reads as a code prefix (spaces and dots allowed). */
export function parseQuery(raw: string): ParsedQuery {
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
  const compact = text.replace(/[\s.-]/g, '');
  const digits = new RegExp(`^\\d{${MIN_CODE_DIGITS},17}$`).test(compact) ? compact : null;
  return { text, digits, tooShort: text.length < MIN_TEXT };
}

type FindingFacts = { severity: Severity; decision: Decision; type: FindingType };

export function productStatus(findings: readonly FindingFacts[]): ProductStatus {
  const risky = findings.filter((f) => f.severity !== 'info');
  if (risky.some((f) => f.decision === 'pending')) return 'attention';
  if (risky.length > 0) return 'decided';
  return findings.length > 0 ? 'info' : 'clean';
}

/** Workspace link that shows this row: all decisions, view chosen; informational rows need their type. */
export function productHref(catalogId: string, name: string, findings: readonly FindingFacts[]): string {
  const query = new URLSearchParams({ q: name.trim().slice(0, MAX_QUERY), pending: '0', v: '0' });
  const info = productStatus(findings) === 'info' ? findings[0]?.type : undefined;
  if (info) query.set('type', info);
  return `/catalogs/${catalogId}?${query.toString()}`;
}

export const EMPTY_RESULTS: Omit<SearchResults, 'query'> = { clients: [], catalogs: [], products: [], codes: [] };

export async function search(user: SearchUser, raw: string, locale: Locale): Promise<SearchResults> {
  const parsed = parseQuery(raw);
  if (parsed.tooShort) return { query: parsed.text, ...EMPTY_RESULTS };
  const [clients, catalogs, products, codes] = await Promise.all([
    findClients(user, parsed.text),
    findCatalogs(user, parsed.text),
    findProducts(user, parsed),
    findCodes(parsed.digits, locale),
  ]);
  return { query: parsed.text, clients, catalogs, products, codes };
}

async function findClients(user: SearchUser, text: string): Promise<ClientHit[]> {
  const rows = await db.client.findMany({
    where: { orgId: user.orgId, archivedAt: null, ...clientScope(user), name: { contains: text, mode: 'insensitive' } },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    take: LIMITS.clients,
    select: { id: true, name: true },
  });
  return rows.map((c) => ({ ...c, href: `/clients/${c.id}` }));
}

async function findCatalogs(user: SearchUser, text: string): Promise<CatalogHit[]> {
  const rows = await db.catalog.findMany({
    where: { ...catalogScope(user), client: { archivedAt: null }, filename: { contains: text, mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
    take: LIMITS.catalogs,
    select: { id: true, filename: true, createdAt: true, status: true, client: { select: { name: true } } },
  });
  return rows.map((c) => ({
    id: c.id, filename: c.filename, createdAt: c.createdAt, status: c.status, clientName: c.client?.name ?? null, href: `/catalogs/${c.id}`,
  }));
}

/** Rows of the latest ready catalogue of every visible, active client, matched by name or code prefix. */
async function findProducts(user: SearchUser, parsed: ParsedQuery): Promise<ProductHit[]> {
  const latest = await db.catalog.findMany({
    where: { ...catalogScope(user), status: 'ready', client: { archivedAt: null } },
    orderBy: [{ clientId: 'asc' }, { createdAt: 'desc' }],
    distinct: ['clientId'],
    select: { id: true, client: { select: { name: true } } },
  });
  if (latest.length === 0) return [];
  const clientOf = new Map(latest.map((c) => [c.id, c.client?.name ?? null]));
  const key = matchKeyOf(parsed.text);
  const match: Prisma.CatalogItemWhereInput[] = [{ rawName: { contains: parsed.text, mode: 'insensitive' } }];
  if (key.length >= MIN_TEXT) match.push({ normalizedName: { contains: key } });
  if (parsed.digits) match.push({ existingMxik: { startsWith: parsed.digits } });
  const rows = await db.catalogItem.findMany({
    where: { catalogId: { in: latest.map((c) => c.id) }, OR: match },
    orderBy: [{ catalogId: 'asc' }, { rowIndex: 'asc' }],
    take: LIMITS.products,
    select: {
      id: true, rawName: true, existingMxik: true, rowIndex: true, catalogId: true,
      findings: { select: { severity: true, decision: true, type: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.rawName,
    code: r.existingMxik,
    row: r.rowIndex + 1,
    clientName: clientOf.get(r.catalogId) ?? null,
    status: productStatus(r.findings),
    href: productHref(r.catalogId, r.rawName, r.findings),
  }));
}

/** Exact 17-digit code, or every code under a prefix of at least five digits. */
async function findCodes(digits: string | null, locale: Locale): Promise<CodeHit[]> {
  if (!digits) return [];
  const rows = await db.mxikCode.findMany({
    where: digits.length === 17 ? { code: digits } : { code: { startsWith: digits } },
    orderBy: { code: 'asc' },
    take: LIMITS.codes,
    select: { code: true, nameUz: true, nameRu: true, retiredAt: true },
  });
  return rows.map((r) => ({
    code: r.code.trim(),
    name: (locale === 'ru' ? r.nameRu || r.nameUz : r.nameUz || r.nameRu).trim(),
    retired: r.retiredAt !== null,
  }));
}
