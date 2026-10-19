// A client's purchase lists ("Kirim") and the NOT_PURCHASED check they feed.
// Every function is scoped by org and by the clients the user may open; the
// check never touches a decided finding, and a list without a single valid
// code is never used (it would flag every sold row as not purchased).
import { z } from 'zod';
import { buildPurchaseIndex, checkPurchased } from '../core/audit/purchases.js';
import { readCode } from '../core/audit/checks.js';
import { canSeeClient } from './access.js';
import { findingData } from './audit-runner.js';
import { db } from './db.js';
import { effectiveCode } from './export-effective.js';
import type { ParseResult } from './spreadsheet.js';
import { mayWrite, type RoleCarrier } from './write-access.js';

export const PurchaseMapSchema = z.object({
  name: z.number().int().min(-1),
  mxik: z.number().int().min(0),
  unit: z.number().int().min(-1),
});
export type PurchaseMap = z.infer<typeof PurchaseMapSchema>;

/** Who acts: the org, the user, for a scoped accountant the clients they may open, and the role (a viewer changes nothing). */
export type ListActor = RoleCarrier & { orgId: string; userId: string; clientIds?: string[] | null };

const HINTS: Record<keyof PurchaseMap, string[]> = {
  name: ['nom', 'tovar', 'mahsulot', 'наимен', 'товар', 'name'],
  mxik: ['mxik', 'ikpu', 'мхик', 'икпу', 'spic'],
  unit: ['birlik', 'oʻlchov', 'olchov', 'единиц', 'изм', 'unit'],
};

export function guessPurchaseMap(headers: readonly string[]): PurchaseMap {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (field: keyof PurchaseMap): number => lower.findIndex((h) => HINTS[field].some((hint) => h.includes(hint)));
  return { name: find('name'), mxik: Math.max(0, find('mxik')), unit: find('unit') };
}

/** What a list keeps for resuming its mapping later: first rows and what the reader skipped. */
export type ListMeta = { sample: string[][]; totalSeen: number; truncated: boolean };
const ListMetaSchema = z.object({ sample: z.array(z.array(z.string())), totalSeen: z.number(), truncated: z.boolean() });
export const readListMeta = (json: unknown): ListMeta | null => ListMetaSchema.safeParse(json).data ?? null;
export const SAMPLE_ROWS = 8;

export const listMeta = (parsed: ParseResult): ListMeta => ({ sample: parsed.rows.slice(0, SAMPLE_ROWS), totalSeen: parsed.totalSeen, truncated: parsed.truncated });

const Original = z.object({ original: z.array(z.string()) });
const cell = (row: readonly string[], i: number): string | null => (i < 0 ? null : row[i]?.trim() || null);
const CHUNK = 1000;
const UPDATE_CHUNK = 5000;

export type ListError = 'not_found' | 'no_codes';
export type ListResult<T> = ({ ok: true } & T) | { ok: false; error: ListError };

/** An archived client of the org: it takes no new purchase, cheque or sales files. */
export async function clientArchived(orgId: string, clientId: string): Promise<boolean> {
  return (await db.client.count({ where: { id: clientId, orgId, archivedAt: { not: null } } })) > 0;
}

/** Stores the file under the client (waiting for its mapping), in one transaction. */
export async function storePurchaseList(actor: ListActor, input: { clientId: string; filename: string; parsed: ParseResult }): Promise<ListResult<{ listId: string; map: PurchaseMap }>> {
  if (!mayWrite(actor)) return { ok: false, error: 'not_found' };
  // An archived client takes no new files.
  const client = await db.client.findFirst({ where: { id: input.clientId, orgId: actor.orgId, archivedAt: null }, select: { id: true } });
  if (!client || !canSeeClient(actor, client.id)) return { ok: false, error: 'not_found' };
  const map = guessPurchaseMap(input.parsed.headers);
  const listId = await db.$transaction(async (tx) => {
    const list = await tx.purchaseList.create({
      data: {
        orgId: actor.orgId, clientId: client.id, filename: input.filename,
        rowCount: input.parsed.rows.length, headers: input.parsed.headers, columnMap: map,
        meta: listMeta(input.parsed),
      },
    });
    for (let i = 0; i < input.parsed.rows.length; i += CHUNK) {
      await tx.purchaseItem.createMany({
        data: input.parsed.rows.slice(i, i + CHUNK).map((row, j) => ({ listId: list.id, rowIndex: i + j, attrs: { original: [...row] } })),
      });
    }
    await tx.auditEvent.create({
      data: {
        orgId: actor.orgId, actorId: actor.userId, action: 'purchases.uploaded', targetId: list.id,
        payload: { clientId: client.id, listId: list.id, filename: input.filename, rowCount: input.parsed.rows.length, truncated: input.parsed.truncated },
      },
    });
    return list.id;
  }, { timeout: 180_000 });
  return { ok: true, listId, map };
}

/** A list the actor may change: in the org, of a client they may open, and not as a viewer. */
async function ownList(actor: ListActor, listId: string): Promise<{ id: string; clientId: string; filename: string } | null> {
  if (!mayWrite(actor)) return null;
  const list = await db.purchaseList.findFirst({ where: { id: listId, orgId: actor.orgId }, select: { id: true, clientId: true, filename: true } });
  return list && canSeeClient(actor, list.clientId) ? list : null;
}

/**
 * Applies the confirmed mapping. With no valid 17-digit code in the chosen
 * column the list stays "columns not chosen" and nothing is re-checked;
 * otherwise it is marked ready and the client's latest catalogue re-checked.
 */
export async function applyPurchaseMap(actor: ListActor, listId: string, map: PurchaseMap): Promise<ListResult<{ codes: number }>> {
  const list = await ownList(actor, listId);
  if (!list) return { ok: false, error: 'not_found' };
  const items = await db.purchaseItem.findMany({ where: { listId }, select: { id: true, attrs: true } });
  const derived = items.map((item) => {
    const row = Original.safeParse(item.attrs).data?.original ?? [];
    const code = readCode(cell(row, map.mxik));
    return { id: item.id, name: cell(row, map.name), mxik: code && code.length === 17 ? code : null, unit: cell(row, map.unit) };
  });
  const codes = new Set(derived.flatMap((d) => (d.mxik ? [d.mxik] : []))).size;
  if (codes === 0) return { ok: false, error: 'no_codes' };

  await db.$transaction(async (tx) => {
    for (let i = 0; i < derived.length; i += UPDATE_CHUNK) {
      const part = derived.slice(i, i + UPDATE_CHUNK);
      await tx.$executeRaw`
        UPDATE purchase_item p SET name = v.name, mxik = v.mxik, unit = v.unit
        FROM unnest(${part.map((d) => d.id)}::text[], ${part.map((d) => d.name)}::text[],
                    ${part.map((d) => d.mxik)}::text[], ${part.map((d) => d.unit)}::text[]) AS v(id, name, mxik, unit)
        WHERE p.id = v.id`;
    }
    await tx.purchaseList.update({ where: { id: listId }, data: { columnMap: map, status: 'ready' } });
    await tx.auditEvent.create({
      data: { orgId: actor.orgId, actorId: actor.userId, action: 'purchases.mapped', targetId: listId, payload: { clientId: list.clientId, listId, codes } },
    });
  }, { timeout: 180_000 });
  await recheckClientPurchases(actor.orgId, list.clientId);
  return { ok: true, codes };
}

export async function deletePurchaseList(actor: ListActor, listId: string): Promise<boolean> {
  const list = await ownList(actor, listId);
  if (!list) return false;
  await db.$transaction([
    db.purchaseList.delete({ where: { id: listId } }),
    db.auditEvent.create({
      data: { orgId: actor.orgId, actorId: actor.userId, action: 'purchases.deleted', targetId: listId, payload: { clientId: list.clientId, listId, filename: list.filename } },
    }),
  ]);
  await recheckClientPurchases(actor.orgId, list.clientId);
  return true;
}

export type Activity = 'savdo' | 'ishlab_chiqarish' | 'boshqa';

/** "Faoliyat turi": decides whether a sale without a purchase is a high risk. */
export async function setClientActivity(actor: ListActor, clientId: string, activity: Activity): Promise<boolean> {
  if (!mayWrite(actor)) return false;
  const client = await db.client.findFirst({ where: { id: clientId, orgId: actor.orgId }, select: { id: true } });
  if (!client || !canSeeClient(actor, client.id)) return false;
  await db.client.update({ where: { id: client.id }, data: { activity } });
  await db.auditEvent.create({
    data: { orgId: actor.orgId, actorId: actor.userId, action: 'client.activity_set', targetId: client.id, payload: { clientId: client.id, activity } },
  });
  await recheckClientPurchases(actor.orgId, client.id);
  return true;
}

/** The client's latest audited catalogue, re-checked against its purchases. */
export async function recheckClientPurchases(orgId: string, clientId: string): Promise<void> {
  const latest = await db.catalog.findFirst({
    where: { orgId, clientId, status: 'ready' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (latest) await runPurchaseCheck(latest.id);
}

/**
 * Replaces the catalogue's pending NOT_PURCHASED findings with fresh ones.
 * Without a ready list holding at least one valid code nothing can be
 * concluded, so none remain. Rows where the reviewer already decided a
 * NOT_PURCHASED finding are left alone.
 */
export async function runPurchaseCheck(catalogId: string): Promise<number> {
  const catalog = await db.catalog.findUnique({
    where: { id: catalogId },
    select: { clientId: true, client: { select: { activity: true } } },
  });
  if (!catalog?.clientId) return 0;
  await db.finding.deleteMany({ where: { item: { catalogId }, type: 'NOT_PURCHASED', decision: 'pending' } });

  const purchases = await db.purchaseItem.findMany({
    where: { list: { clientId: catalog.clientId, status: 'ready' }, mxik: { not: null } },
    select: { mxik: true, unit: true },
  });
  const index = buildPurchaseIndex(purchases);
  if (index.size === 0) return 0;
  const activity = catalog.client?.activity ?? 'boshqa';

  const items = await db.catalogItem.findMany({
    where: { catalogId },
    select: {
      id: true, existingMxik: true, unit: true,
      findings: { select: { type: true, severity: true, decision: true, chosenMxik: true, decidedAt: true } },
    },
  });
  const rows = items.flatMap((item) => {
    if (item.findings.some((f) => f.type === 'NOT_PURCHASED')) return [];
    // Judge the code the row will carry: the same rule as the exports.
    const finding = checkPurchased({ code: effectiveCode(item.existingMxik, item.findings), unit: item.unit }, index, activity);
    return finding ? findingData(item.id, [finding]) : [];
  });
  for (let i = 0; i < rows.length; i += CHUNK) await db.finding.createMany({ data: rows.slice(i, i + CHUNK) });
  return rows.length;
}
