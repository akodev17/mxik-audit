// Account data control: soft delete with a grace period, hard delete by the daily job,
// the org-level retention of uploaded raw cells, and the data export.
import { db } from '@tasnivo/db';
import { revokeOrgSessions } from './session-store';

export const RETENTION_CHOICES = [7, 30, 90] as const;
const DEFAULT_DELETE_AFTER_DAYS = 30;

export function deleteAfterDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env['ACCOUNT_DELETE_AFTER_DAYS']);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_DELETE_AFTER_DAYS;
}

const DAY = 86_400_000;

/** Closes the account: nobody can sign in except an admin who may restore it, until the purge date. */
export async function requestDeletion(actor: { userId: string; orgId: string }, now = new Date()): Promise<Date | null> {
  const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { kind: true, deletedAt: true } });
  if (!org || org.kind !== 'customer' || org.deletedAt) return null;
  await db.organization.update({ where: { id: actor.orgId }, data: { deletedAt: now } });
  await db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'account.deletion_requested', payload: { purgeAfterDays: deleteAfterDays() } } });
  await revokeOrgSessions(actor.orgId);
  return new Date(now.getTime() + deleteAfterDays() * DAY);
}

export async function restoreAccount(actor: { userId: string; orgId: string }): Promise<boolean> {
  const done = await db.organization.updateMany({ where: { id: actor.orgId, deletedAt: { not: null } }, data: { deletedAt: null } });
  if (done.count === 0) return false;
  await db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'account.restored', payload: {} } });
  return true;
}

/** When the closed account will be erased, or null if it is not closed. */
export async function purgeDate(orgId: string): Promise<Date | null> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { deletedAt: true } });
  return org?.deletedAt ? new Date(org.deletedAt.getTime() + deleteAfterDays() * DAY) : null;
}

/**
 * Erases accounts closed longer than the grace period; everything under the org goes with it except
 * its orders and their provider transactions, which stay as payment records (Order.orgId set null).
 */
export async function purgeDeletedAccounts(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - deleteAfterDays() * DAY);
  const due = await db.organization.findMany({ where: { kind: 'customer', deletedAt: { lt: cutoff } }, select: { id: true } });
  if (due.length === 0) return 0;
  const ids = due.map((o) => o.id);
  await db.$executeRaw`DELETE FROM rerank_cache WHERE scope = ANY(${ids})`;
  const removed = await db.organization.deleteMany({ where: { id: { in: ids }, kind: 'customer', deletedAt: { lt: cutoff } } });
  return removed.count;
}

export async function setRetention(actor: { userId: string; orgId: string }, days: number | null): Promise<boolean> {
  if (days !== null && !(RETENTION_CHOICES as readonly number[]).includes(days)) return false;
  await db.organization.update({ where: { id: actor.orgId }, data: { rawRetentionDays: days } });
  await db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'retention.changed', payload: { days } } });
  return true;
}

type Table = 'catalog' | 'purchase_list' | 'doc_list';
type ItemTable = { items: string; fk: string };
const ITEMS: Record<Table, ItemTable> = {
  catalog: { items: 'catalog_item', fk: 'catalogId' },
  purchase_list: { items: 'purchase_item', fk: 'listId' },
  doc_list: { items: 'doc_item', fk: 'listId' },
};

/** Indexes of the columns the mapping uses; the rest of the uploaded cells are blanked. */
export function mappedColumns(columnMap: unknown): number[] {
  if (!columnMap || typeof columnMap !== 'object') return [];
  return Object.values(columnMap).filter((v): v is number => Number.isInteger(v) && v >= 0);
}

async function blank(table: Table, id: string, keep: number[]): Promise<void> {
  const { items, fk } = ITEMS[table];
  // Rebuilds attrs.original keeping only the mapped positions; the array keeps its length so exports still line up.
  await db.$executeRawUnsafe(
    `UPDATE "${items}" SET attrs = jsonb_set(attrs, '{original}', COALESCE((
       SELECT jsonb_agg(CASE WHEN (t.ord - 1)::int = ANY($2::int[]) THEN t.v ELSE '""'::jsonb END ORDER BY t.ord)
       FROM jsonb_array_elements(attrs->'original') WITH ORDINALITY AS t(v, ord)), '[]'::jsonb))
     WHERE "${fk}" = $1 AND jsonb_typeof(attrs->'original') = 'array'`,
    id, keep,
  );
  if (table === 'catalog') {
    // The rows the commit skipped (no name) keep their cells for the export: the same rule applies to them.
    await db.$executeRawUnsafe(
      `UPDATE "catalog_skipped_row" SET original = COALESCE((
         SELECT jsonb_agg(CASE WHEN (t.ord - 1)::int = ANY($2::int[]) THEN t.v ELSE '""'::jsonb END ORDER BY t.ord)
         FROM jsonb_array_elements(original) WITH ORDINALITY AS t(v, ord)), '[]'::jsonb)
       WHERE "catalogId" = $1 AND jsonb_typeof(original) = 'array'`,
      id, keep,
    );
  }
  await db.$executeRawUnsafe(`UPDATE "${table}" SET "rawPurgedAt" = now() WHERE id = $1`, id);
}

/**
 * Blanks the unmapped original cells of finished uploads older than each org's
 * retention window. Never retroactive: only uploads made at or after the org's
 * rawRetentionSince are touched, and an org without that date is skipped.
 */
export async function purgeRawFiles(now = new Date()): Promise<{ catalogs: number; purchaseLists: number; docLists: number }> {
  const orgs = await db.organization.findMany({
    where: { rawRetentionDays: { not: null }, rawRetentionSince: { not: null }, kind: 'customer' },
    select: { id: true, rawRetentionDays: true, rawRetentionSince: true },
  });
  const done = { catalogs: 0, purchaseLists: 0, docLists: 0 };
  for (const org of orgs) {
    if (org.rawRetentionDays === null || org.rawRetentionSince === null) continue;
    const cutoff = new Date(now.getTime() - org.rawRetentionDays * DAY);
    if (cutoff <= org.rawRetentionSince) continue;
    const where = { orgId: org.id, createdAt: { gte: org.rawRetentionSince, lt: cutoff }, rawPurgedAt: null };
    let purged = 0;
    for (const c of await db.catalog.findMany({ where: { ...where, status: { in: ['ready', 'failed'] } }, select: { id: true, columnMap: true } })) {
      await blank('catalog', c.id, mappedColumns(c.columnMap));
      done.catalogs++;
      purged++;
    }
    for (const l of await db.purchaseList.findMany({ where: { ...where, status: 'ready' }, select: { id: true, columnMap: true } })) {
      await blank('purchase_list', l.id, mappedColumns(l.columnMap));
      done.purchaseLists++;
      purged++;
    }
    for (const l of await db.docList.findMany({ where: { ...where, status: { in: ['ready', 'failed'] } }, select: { id: true, columnMap: true } })) {
      await blank('doc_list', l.id, mappedColumns(l.columnMap));
      done.docLists++;
      purged++;
    }
    if (purged > 0) {
      await db.auditEvent.create({ data: { orgId: org.id, actorId: null, action: 'retention.purged', payload: { retentionDays: org.rawRetentionDays } } });
    }
  }
  return done;
}
