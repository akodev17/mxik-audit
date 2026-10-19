// Global search behind the command palette: clients, catalogues, products of each visible
// client's latest audited catalogue, and classifier codes. Every query is scoped to the user.
import { Prisma, type CatalogStatus, type Severity, type Decision, type FindingType } from '@prisma/client';
import { matchKeyOf } from '../core/normalize/index.js';
import { catalogScope, clientScope } from './access.js';
import { db } from './db.js';
import { isAutomatic, readDecisionSource } from './decision-source.js';
import type { Locale } from './i18n.js';
import type { CurrentUser } from './session.js';

export type SearchUser = Pick<CurrentUser, 'orgId' | 'clientIds'>;

/**
 * attention: a risky finding still pending; decided: every risky finding decided by a person;
 * auto: every risky finding decided, at least one with no person involved (dictionary auto-accept,
 * carried over from the previous version); info: only informational findings; clean: nothing detected.
 */
export type ProductStatus = 'attention' | 'decided' | 'auto' | 'info' | 'clean';

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

type FindingFacts = { severity: Severity; decision: Decision; type: FindingType; decisionSource?: string | null };

export function productStatus(findings: readonly FindingFacts[]): ProductStatus {
  const risky = findings.filter((f) => f.severity !== 'info');
  if (risky.some((f) => f.decision === 'pending')) return 'attention';
  if (risky.some((f) => isAutomatic(readDecisionSource(f.decisionSource)))) return 'auto';
  if (risky.length > 0) return 'decided';
  return findings.length > 0 ? 'info' : 'clean';
}

/**
 * Workspace link that shows this row: all decisions, view chosen; informational rows need their type.
 * The workspace lists only rows with findings, so a clean row opens its catalogue unfiltered.
 */
export function productHref(catalogId: string, name: string, findings: readonly FindingFacts[]): string {
  const status = productStatus(findings);
  if (status === 'clean') return `/catalogs/${catalogId}`;
  const query = new URLSearchParams({ q: name.trim().slice(0, MAX_QUERY), pending: '0', v: '0' });
  const info = status === 'info' ? findings[0]?.type : undefined;
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

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

/** Match and rank conditions: 0 = exact name or code, 1 = name or code starts with the query, 2 = contains it. */
function productMatch(parsed: ParsedQuery): { where: Prisma.Sql; rank: Prisma.Sql } {
  const text = escapeLike(parsed.text);
  const key = matchKeyOf(parsed.text);
  const useKey = key.length >= MIN_TEXT;
  const where = [Prisma.sql`i."rawName" ILIKE ${`%${text}%`}`];
  const exact = [Prisma.sql`lower(i."rawName") = lower(${parsed.text})`];
  const prefix = [Prisma.sql`i."rawName" ILIKE ${`${text}%`}`];
  if (useKey) {
    where.push(Prisma.sql`i."normalizedName" LIKE ${`%${escapeLike(key)}%`}`);
    exact.push(Prisma.sql`i."normalizedName" = ${key}`);
    prefix.push(Prisma.sql`i."normalizedName" LIKE ${`${escapeLike(key)}%`}`);
  }
  if (parsed.digits) {
    where.push(Prisma.sql`i."existingMxik" LIKE ${`${parsed.digits}%`}`);
    exact.push(Prisma.sql`i."existingMxik" = ${parsed.digits}`);
    prefix.push(Prisma.sql`i."existingMxik" LIKE ${`${parsed.digits}%`}`);
  }
  const or = (parts: Prisma.Sql[]): Prisma.Sql => Prisma.join(parts, ' OR ');
  return { where: or(where), rank: Prisma.sql`CASE WHEN ${or(exact)} THEN 0 WHEN ${or(prefix)} THEN 1 ELSE 2 END` };
}

type ProductRow = { id: string; raw_name: string; existing_mxik: string | null; row_index: number; catalog_id: string; client_name: string | null };

/**
 * Rows of the latest ready catalogue of every visible, active client, matched by name or code
 * prefix: exact matches first, then prefixes, then the rest; within each, by client name and row.
 */
async function findProducts(user: SearchUser, parsed: ParsedQuery): Promise<ProductHit[]> {
  const latest = await db.catalog.findMany({
    where: { ...catalogScope(user), status: 'ready', client: { archivedAt: null } },
    orderBy: [{ clientId: 'asc' }, { createdAt: 'desc' }],
    distinct: ['clientId'],
    select: { id: true },
  });
  if (latest.length === 0) return [];
  const { where, rank } = productMatch(parsed);
  const rows = await db.$queryRaw<ProductRow[]>(Prisma.sql`
    SELECT i.id, i."rawName" AS raw_name, i."existingMxik" AS existing_mxik, i."rowIndex" AS row_index,
      i."catalogId" AS catalog_id, cl.name AS client_name
    FROM catalog_item i
      JOIN catalog k ON k.id = i."catalogId"
      LEFT JOIN client cl ON cl.id = k."clientId"
    WHERE i."catalogId" = ANY(${latest.map((c) => c.id)}) AND (${where})
    ORDER BY ${rank}, cl.name ASC NULLS LAST, i."catalogId" ASC, i."rowIndex" ASC
    LIMIT ${LIMITS.products}`);
  if (rows.length === 0) return [];
  const findings = await db.finding.findMany({
    where: { itemId: { in: rows.map((r) => r.id) } },
    select: { itemId: true, severity: true, decision: true, type: true, decisionSource: true },
  });
  const byItem = new Map<string, typeof findings>();
  for (const f of findings) byItem.set(f.itemId, [...(byItem.get(f.itemId) ?? []), f]);
  return rows.map((r) => {
    const own = byItem.get(r.id) ?? [];
    return {
      id: r.id,
      name: r.raw_name,
      code: r.existing_mxik,
      row: r.row_index + 1,
      clientName: r.client_name,
      status: productStatus(own),
      href: productHref(r.catalog_id, r.raw_name, own),
    };
  });
}

type CodeRow = { code: string; nameUz: string; nameRu: string; retiredAt: Date | null };

/**
 * Exact 17-digit code, or every code under a prefix of at least five digits.
 * Raw SQL because Prisma's startsWith casts the char(17) key to text, which no index serves.
 * A plain LIKE uses mxik_code_code_prefix_idx (bpchar_pattern_ops), and ordering by that
 * index's operator lets the scan stop at the limit; codes are digits only, so the order is the same.
 */
async function findCodes(digits: string | null, locale: Locale): Promise<CodeHit[]> {
  if (!digits) return [];
  const rows = await db.$queryRaw<CodeRow[]>(Prisma.sql`
    SELECT code, "nameUz", "nameRu", "retiredAt" FROM mxik_code
    WHERE code LIKE ${`${escapeLike(digits)}%`}
    ORDER BY code USING ~<~
    LIMIT ${LIMITS.codes}`);
  return rows.map((r) => ({
    code: r.code.trim(),
    name: (locale === 'ru' ? r.nameRu || r.nameUz : r.nameUz || r.nameRu).trim(),
    retired: r.retiredAt !== null,
  }));
}
