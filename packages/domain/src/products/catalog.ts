// The /products page's operations: the list, a product's drawer (aliases, runner-up codes, Tasnif
// packaging), "Confirm MXIK" (→ FirmMapping), checking products in chunks, "Add to product
// catalogue" from a finished audit, and the hand-over of the catalogue to the 1C module.
// Scope: a member who sees every client sees the org's own products too; one scoped to some
// clients sees only theirs. Server-only.
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@tasnivo/db';
import type { accounting } from '@tasnivo/contracts';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import type { z } from 'zod';
import { canSeeClient, canWrite } from '../access.js';
import { visibleClients } from '../active-client.js';
import { learn } from '../dictionary.js';
import { codeUnits, exportItems, exportUnit } from '../export-rows.js';
import { buildExport, prepareExport } from '../onec/index.js';
import type { CurrentUser } from '../session.js';
import { classifyDetailed, type DetailedClassification } from './classify.js';
import { displayBarcode, productNameKey } from './keys.js';
import { packagesFor } from './packaging.js';
import { upsertRecords } from './upsert.js';

type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;
type MatchCandidate = z.infer<typeof accounting.MatchCandidate>;
type ProductRecord = z.infer<typeof accounting.ProductRecord>;
type Status = ProductRecord['mxikStatus'];

export const PRODUCT_PAGE = 50;
/** Products classified per "check" call; the page calls again while some remain. */
export const CHECK_CHUNK = 100;
const STATUSES: readonly Status[] = ['ok', 'missing', 'invalid', 'inactive', 'restricted', 'suspicious', 'unchecked'];

export type ProductRowOut = {
  id: string; name: string; clientId: string | null; clientName: string | null; onecRef: string | null; mxik: string | null; mxikName: string | null;
  packageCode: string | null; packageName: string | null; unit: string | null; barcode: string | null; source: string; mxikStatus: Status;
  issues: ValidationIssue[]; suggestion: MatchCandidate | null; markingRequired: boolean | null; checkedAt: string | null; confirmedAt: string | null; updatedAt: string;
};

type Scoped = Pick<CurrentUser, 'orgId' | 'clientIds'>;

/** The products a user may see. */
export function productScope(user: Scoped): Prisma.ProductWhereInput {
  return user.clientIds == null ? { orgId: user.orgId } : { orgId: user.orgId, clientId: { in: user.clientIds } };
}

const asIssues = (v: Prisma.JsonValue | null): ValidationIssue[] => (Array.isArray(v) ? v as unknown as ValidationIssue[] : []);
const asCandidate = (v: Prisma.JsonValue | null): MatchCandidate | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as unknown as MatchCandidate : null);
const asStatus = (v: string): Status => (STATUSES.includes(v as Status) ? v as Status : 'unchecked');

const ROW_SELECT = {
  id: true, name: true, clientId: true, onecRef: true, mxik: true, mxikName: true, packageCode: true, packageName: true, unit: true, barcode: true,
  source: true, mxikStatus: true, mxikIssues: true, mxikSuggestion: true, markingRequired: true, mxikCheckedAt: true, mxikConfirmedAt: true, updatedAt: true,
  client: { select: { name: true } },
} as const;

type RowIn = Prisma.ProductGetPayload<{ select: typeof ROW_SELECT }>;

function rowOut(p: RowIn): ProductRowOut {
  return {
    id: p.id, name: p.name, clientId: p.clientId, clientName: p.client?.name ?? null, onecRef: p.onecRef, mxik: p.mxik?.trim() ?? null, mxikName: p.mxikName,
    packageCode: p.packageCode, packageName: p.packageName, unit: p.unit, barcode: displayBarcode(p.barcode), source: p.source, mxikStatus: asStatus(p.mxikStatus),
    issues: asIssues(p.mxikIssues), suggestion: asCandidate(p.mxikSuggestion), markingRequired: p.markingRequired,
    checkedAt: p.mxikCheckedAt?.toISOString() ?? null, confirmedAt: p.mxikConfirmedAt?.toISOString() ?? null, updatedAt: p.updatedAt.toISOString(),
  };
}

export type ListParams = { q?: string | undefined; status?: string | undefined; client?: string | undefined; page?: number | undefined };

/** One page of products, searched by name / MXIK / barcode, with counts per status for the chips. */
export async function listProducts(user: Scoped, params: ListParams) {
  const q = (params.q ?? '').trim().slice(0, 100);
  const page = Math.max(0, Math.floor(params.page ?? 0));
  const status = params.status && STATUSES.includes(params.status as Status) ? params.status as Status : null;
  const scope = productScope(user);
  const client = params.client === 'own' ? { clientId: null } : params.client && canSeeClient(user, params.client) ? { clientId: params.client } : {};
  const digits = q.replace(/\D/g, '');
  const search: Prisma.ProductWhereInput = q ? { OR: [
    { name: { contains: q, mode: 'insensitive' } },
    { normalizedName: { contains: productNameKey(q) } },
    ...(digits.length >= 4 ? [{ mxik: { startsWith: digits } }, { barcode: { contains: digits } }] : []),
    { aliases: { some: { normalizedAlias: { contains: productNameKey(q) } } } },
  ] } : {};
  const base: Prisma.ProductWhereInput = { AND: [scope, client, search] };
  const where: Prisma.ProductWhereInput = status ? { AND: [base, { mxikStatus: status }] } : base;
  const [grouped, total, rows, clients] = await Promise.all([
    db.product.groupBy({ by: ['mxikStatus'], where: base, _count: { _all: true } }),
    db.product.count({ where }),
    db.product.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: page * PRODUCT_PAGE, take: PRODUCT_PAGE, select: ROW_SELECT }),
    visibleClients(user),
  ]);
  const counts: Record<'all' | Status, number> = { all: 0, ok: 0, missing: 0, invalid: 0, inactive: 0, restricted: 0, suspicious: 0, unchecked: 0 };
  for (const g of grouped) {
    counts[asStatus(g.mxikStatus)] += g._count._all;
    counts.all += g._count._all;
  }
  return { rows: rows.map(rowOut), counts, total, pageSize: PRODUCT_PAGE, clients };
}

/** A product with its aliases and the runner-up codes of its last check; null when out of scope. */
export async function productDetail(user: Scoped, productId: string) {
  const p = await db.product.findFirst({
    where: { AND: [productScope(user), { id: productId }] },
    select: { ...ROW_SELECT, mxikAlternatives: true, aliases: { select: { alias: true }, orderBy: { createdAt: 'asc' } } },
  });
  if (!p) return null;
  const alternatives = Array.isArray(p.mxikAlternatives) ? p.mxikAlternatives as unknown as MatchCandidate[] : [];
  return { product: rowOut(p), aliases: p.aliases.map((a) => a.alias), alternatives };
}

/** The Tasnif packaging codes of the product's MXIK: cached, fetched on first ask. */
export async function productPackages(user: Scoped, productId: string) {
  const p = await db.product.findFirst({ where: { AND: [productScope(user), { id: productId }] }, select: { mxik: true } });
  if (!p) return null;
  const code = p.mxik?.trim();
  if (!code) return { source: 'none' as const, reason: null, packages: [] };
  const state = (await packagesFor([code])).get(code);
  if (!state) return { source: 'none' as const, reason: null, packages: [] };
  return {
    source: state.source, reason: state.reason ?? null,
    packages: state.packages.map((x) => ({
      code: x.code, name: x.name, nameRu: x.nameRu, nameUz: x.nameUz, containerName: x.containerName, unitName: x.unitName, parentValue: x.parentValue, parentCode: x.parentCode,
    })),
  };
}

/** Stores a classification on its product. */
function classifiedData(c: DetailedClassification, now: Date): Prisma.ProductUpdateInput {
  return {
    mxikStatus: c.mxikStatus,
    mxikIssues: c.issues,
    mxikSuggestion: c.mxikSuggestion ? c.mxikSuggestion : Prisma.DbNull,
    mxikAlternatives: c.alternatives,
    mxikCheckedAt: now,
    ...(c.mxikName ? { mxikName: c.mxikName } : {}),
    ...(c.packageName ? { packageName: c.packageName } : {}),
    ...(c.markingRequired !== null ? { markingRequired: c.markingRequired } : {}),
  };
}

/** Classifies the given products and stores the result on each. */
export async function checkProductIds(orgId: string, ids: readonly string[], locale: Locale): Promise<number> {
  const rows = await db.product.findMany({ where: { orgId, id: { in: [...ids] } }, select: { id: true, name: true, mxik: true, barcode: true, unit: true, packageCode: true } });
  if (rows.length === 0) return 0;
  const out = await classifyDetailed(orgId, rows.map((r) => ({ name: r.name, mxik: r.mxik?.trim() ?? null, barcode: r.barcode, unit: r.unit, packageCode: r.packageCode })), { locale });
  const now = new Date();
  await db.$transaction(rows.map((r, i) => db.product.update({ where: { id: r.id }, data: classifiedData(out[i] as DetailedClassification, now) })));
  return rows.length;
}

/** "Check": the given products, or the next CHECK_CHUNK unchecked ones the user may see. */
export async function checkProducts(user: CurrentUser, input: { ids?: string[] | undefined; unchecked?: boolean | undefined; clientId?: string | undefined }, locale: Locale) {
  if (!canWrite(user)) return { checked: 0, remaining: 0 };
  const scope = productScope(user);
  const client = input.clientId && canSeeClient(user, input.clientId) ? { clientId: input.clientId } : {};
  const ids = input.ids?.length
    ? (await db.product.findMany({ where: { AND: [scope, { id: { in: input.ids.slice(0, CHECK_CHUNK) } }] }, select: { id: true } })).map((r) => r.id)
    : input.unchecked
      ? (await db.product.findMany({ where: { AND: [scope, client, { mxikStatus: 'unchecked' }] }, orderBy: { createdAt: 'asc' }, take: CHECK_CHUNK, select: { id: true } })).map((r) => r.id)
      : [];
  const checked = await checkProductIds(user.orgId, ids, locale);
  const remaining = input.unchecked ? await db.product.count({ where: { AND: [scope, client, { mxikStatus: 'unchecked' }] } }) : 0;
  return { checked, remaining };
}

export type ConfirmOutcome = { ok: true; product: ProductRowOut } | { ok: false; error: string };

/**
 * "Confirm MXIK": a person settles the product's code. Only a live classifier code is taken; it is
 * stored and re-checked (a confirmed code can still be restricted or carry the wrong unit), the
 * firm dictionary learns it as one individual confirmation, and the audit log keeps the change.
 */
export async function confirmProductMxik(user: CurrentUser, productId: string, rawCode: string, locale: Locale): Promise<ConfirmOutcome> {
  const e = i18nFor(locale).ta.productsX.confirmErrors;
  if (!canWrite(user)) return { ok: false, error: i18nFor(locale).t.errorGeneric };
  const code = rawCode.replace(/\D/g, '');
  if (!/^\d{17}$/.test(code)) return { ok: false, error: e.format };
  const p = await db.product.findFirst({ where: { AND: [productScope(user), { id: productId }] }, select: { id: true, name: true, unit: true, barcode: true, mxik: true } });
  if (!p) return { ok: false, error: e.notFound };
  const live = await db.mxikCode.findFirst({ where: { code, retiredAt: null }, select: { code: true } });
  if (!live) return { ok: false, error: e.notLive };
  const now = new Date();
  await db.product.update({ where: { id: p.id }, data: { mxik: code, mxikConfirmedAt: now, mxikConfirmedBy: user.userId } });
  await checkProductIds(user.orgId, [p.id], locale);
  await learn(user.orgId, user.userId, [{ rawName: p.name, unit: p.unit, barcode: p.barcode, code }], 'manual');
  await db.auditEvent.create({
    data: { orgId: user.orgId, actorId: user.userId, action: 'product.mxik_confirmed', targetId: p.id, payload: { code, previousCode: p.mxik?.trim() ?? null } },
  });
  const after = await db.product.findUniqueOrThrow({ where: { id: p.id }, select: ROW_SELECT });
  return { ok: true, product: rowOut(after) };
}

/**
 * "Add to product catalogue" on a finished audit: its settled rows (nothing risky found, or every
 * risky finding decided) become products under the audit's client, with the code the export would
 * write and the unit a strictly bound code fixes. Rows still pending are left out.
 */
export async function productsFromAudit(user: CurrentUser, catalogId: string, locale: Locale) {
  const x = i18nFor(locale).ta;
  if (!canWrite(user)) return { ok: false as const, error: x.productsX.fromAudit.none };
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, orgId: user.orgId }, select: { id: true, clientId: true, status: true } });
  if (!catalog || !canSeeClient(user, catalog.clientId) || catalog.status !== 'ready') return { ok: false as const, error: i18nFor(locale).t.errorGeneric };
  const items = await exportItems(catalogId);
  const settled = items.filter((i) => i.effective.review === 'ok' || i.effective.review === 'accepted' || i.effective.review === 'rejected');
  if (settled.length === 0) return { ok: false as const, error: x.productsX.fromAudit.none };
  const units = await codeUnits(settled.map((i) => i.effective.code ?? ''));
  const records: ProductRecord[] = settled.map((i) => ({
    productId: null, name: i.rawName, onecRef: null, mxik: i.effective.code && /^\d{17}$/.test(i.effective.code) ? i.effective.code : null, mxikName: null,
    packageCode: null, packageName: null, unit: exportUnit(i, units) || null, barcode: i.barcode, aliases: [],
    // A clean or accepted row passed the audit; a kept code the reviewer looked at is checked again here.
    mxikStatus: i.effective.code ? (i.effective.review === 'rejected' ? 'unchecked' : 'ok') : 'missing',
    mxikSuggestion: null, markingRequired: null,
  }));
  const result = await upsertRecords(user.orgId, catalog.clientId, records, user.userId, { source: 'audit' });
  await db.auditEvent.create({ data: { orgId: user.orgId, actorId: user.userId, action: 'product.from_audit', targetId: catalogId, payload: { rows: settled.length, created: result.created, updated: result.updated } } });
  return { ok: true as const, created: result.created, updated: result.updated, rows: settled.length };
}

/** `leftOut`: records of the batch the file does not carry (skipped, unresolved, not approved, duplicates). */
export type Handover = { ok: true; exportId: string; filename: string | null; records: number; leftOut: number } | { ok: false; unavailable: boolean; error: string };

/**
 * The org's products as ProductRecords, in the order of `ids` (unknown ids are left out); for the
 * Didox workflow, which resolves an invoice line to a product and needs its code, package and unit.
 */
export async function getProductRecords(orgId: string, ids: readonly string[]): Promise<ProductRecord[]> {
  if (ids.length === 0) return [];
  const rows = await db.product.findMany({
    where: { orgId, id: { in: [...new Set(ids)] } },
    select: {
      id: true, name: true, onecRef: true, mxik: true, mxikName: true, packageCode: true, packageName: true, unit: true, barcode: true,
      mxikStatus: true, mxikSuggestion: true, markingRequired: true, aliases: { select: { alias: true }, orderBy: { createdAt: 'asc' }, take: 50 },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    return [{
      productId: r.id, name: r.name, onecRef: r.onecRef, mxik: r.mxik?.trim() ?? null, mxikName: r.mxikName, packageCode: r.packageCode, packageName: r.packageName,
      unit: r.unit, barcode: displayBarcode(r.barcode), aliases: r.aliases.map((a) => a.alias), mxikStatus: asStatus(r.mxikStatus),
      mxikSuggestion: asCandidate(r.mxikSuggestion), markingRequired: r.markingRequired,
    }];
  });
}

/** Asks the 1C module for a nomenclature_xlsx of a batch: prepare (validate, dedupe), then build. */
export async function handOverBatch(user: CurrentUser, batchId: string, locale: Locale): Promise<Handover> {
  const unavailable = i18nFor(locale).ta.productsX.importWizard.exportUnavailable;
  const prepared = await prepareExport({ orgId: user.orgId, batchId, format: 'nomenclature_xlsx' });
  if (!prepared.ok) return { ok: false, unavailable: prepared.error === 'not_implemented', error: prepared.error === 'not_implemented' ? unavailable : prepared.error };
  const built = await buildExport({ orgId: user.orgId, batchId, format: 'nomenclature_xlsx', actorId: user.userId });
  if (!built.ok) return { ok: false, unavailable: built.error === 'not_implemented', error: built.error === 'not_implemented' ? unavailable : built.error };
  // The file name travels in Content-Disposition, as for every other download.
  const disposition = built.file.headers['Content-Disposition'] ?? built.file.headers['content-disposition'] ?? '';
  const filename = /filename*?=(?:UTF-8'')?"?([^";]+)/i.exec(disposition)?.[1] ?? null;
  const total = await db.importRecord.count({ where: { batchId } });
  return { ok: true, exportId: built.exportId, filename: filename ? decodeURIComponent(filename) : null, records: built.records, leftOut: Math.max(0, total - built.records) };
}

/**
 * Export the catalogue (or a client's, or one status) to 1C: a product_catalog batch of the
 * products as approved ProductRecords, handed to the 1C module. While that module is the stub the
 * batch is removed again and the answer says "available after integration".
 */
export async function exportProducts(user: CurrentUser, input: { clientId?: string | undefined; status?: string | undefined }, locale: Locale): Promise<Handover> {
  const unavailable = i18nFor(locale).ta.productsX.importWizard.exportUnavailable;
  if (!canWrite(user)) return { ok: false, unavailable: false, error: i18nFor(locale).t.errorGeneric };
  const clientId = input.clientId && canSeeClient(user, input.clientId) ? input.clientId : null;
  const status = input.status && STATUSES.includes(input.status as Status) ? { mxikStatus: input.status } : {};
  const rows = await db.product.findMany({
    where: { AND: [productScope(user), clientId ? { clientId } : {}, status] }, orderBy: { name: 'asc' },
    select: { id: true, name: true, onecRef: true, mxik: true, mxikName: true, packageCode: true, packageName: true, unit: true, barcode: true, mxikStatus: true, markingRequired: true, updatedAt: true },
  });
  if (rows.length === 0) return { ok: false, unavailable: false, error: i18nFor(locale).ta.productsX.empty.filtered };
  const fingerprint = createHash('sha256').update(rows.map((r) => `${r.id}@${r.updatedAt.toISOString()}`).join('\n')).digest('hex');
  const existing = await db.importBatch.findUnique({ where: { orgId_kind_fingerprint: { orgId: user.orgId, kind: 'product_catalog', fingerprint } }, select: { id: true } });
  const batchId = existing?.id ?? (await db.importBatch.create({
    data: {
      orgId: user.orgId, clientId, kind: 'product_catalog', source: 'products', filename: 'nomenklatura.xlsx', fingerprint, status: 'approved', createdBy: user.userId,
      meta: { source: 'products', headers: [], columnMap: {}, catalogId: null },
      counts: { total: rows.length, valid: rows.length, corrected: 0, suspicious: 0, unresolved: 0, skipped: 0, exported: 0 },
      records: {
        create: rows.map((r, rowIndex) => ({
          rowIndex, status: 'valid', issues: [],
          // Product + version: an unchanged product another export already carried is left out as a duplicate; a changed one goes again.
          fingerprint: `product:${r.id}@${r.updatedAt.toISOString()}`, decision: { action: 'approve' },
          payload: {
            productId: r.id, name: r.name, onecRef: r.onecRef, mxik: r.mxik?.trim() ?? null, mxikName: r.mxikName, packageCode: r.packageCode, packageName: r.packageName,
            unit: r.unit, barcode: displayBarcode(r.barcode), aliases: [], mxikStatus: asStatus(r.mxikStatus), mxikSuggestion: null, markingRequired: r.markingRequired,
          } satisfies ProductRecord,
        })),
      },
    },
    select: { id: true },
  })).id;
  const out = await handOverBatch(user, batchId, locale);
  if (!out.ok && out.unavailable && !existing) await db.importBatch.delete({ where: { id: batchId } });
  return out.ok || !out.unavailable ? out : { ok: false, unavailable: true, error: unavailable };
}
