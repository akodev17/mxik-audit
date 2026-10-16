// A client's purchase lists ("Kirim") and the NOT_PURCHASED check they feed.
// Every function is scoped by org; the check never touches a decided finding.
import { z } from 'zod';
import { buildPurchaseIndex, checkPurchased } from '../core/audit/purchases.js';
import { readCode } from '../core/audit/checks.js';
import { findingData } from './audit-runner.js';
import { db } from './db.js';
import type { ParseResult } from './spreadsheet.js';

export const PurchaseMapSchema = z.object({
  name: z.number().int().min(-1),
  mxik: z.number().int().min(0),
  unit: z.number().int().min(-1),
});
export type PurchaseMap = z.infer<typeof PurchaseMapSchema>;

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

const Original = z.object({ original: z.array(z.string()) });
const cell = (row: readonly string[], i: number): string | null => (i < 0 ? null : row[i]?.trim() || null);
const CHUNK = 1000;

export async function storePurchaseList(input: { orgId: string; clientId: string; filename: string; parsed: ParseResult }): Promise<{ listId: string; map: PurchaseMap }> {
  const map = guessPurchaseMap(input.parsed.headers);
  const list = await db.purchaseList.create({
    data: {
      orgId: input.orgId, clientId: input.clientId, filename: input.filename,
      rowCount: input.parsed.rows.length, headers: input.parsed.headers, columnMap: map,
    },
  });
  for (let i = 0; i < input.parsed.rows.length; i += CHUNK) {
    await db.purchaseItem.createMany({
      data: input.parsed.rows.slice(i, i + CHUNK).map((row, j) => ({ listId: list.id, rowIndex: i + j, attrs: { original: [...row] } })),
    });
  }
  return { listId: list.id, map };
}

/** Applies the confirmed mapping, marks the list ready and re-runs the check. */
export async function applyPurchaseMap(orgId: string, listId: string, map: PurchaseMap): Promise<{ codes: number } | null> {
  const list = await db.purchaseList.findFirst({ where: { id: listId, orgId }, select: { id: true, clientId: true } });
  if (!list) return null;
  const items = await db.purchaseItem.findMany({ where: { listId }, select: { id: true, attrs: true } });
  const derived = items.map((item) => {
    const row = Original.safeParse(item.attrs).data?.original ?? [];
    const code = readCode(cell(row, map.mxik));
    return { id: item.id, name: cell(row, map.name), mxik: code && code.length === 17 ? code : null, unit: cell(row, map.unit) };
  });
  await db.$transaction(async (tx) => {
    for (const d of derived) {
      await tx.purchaseItem.update({ where: { id: d.id }, data: { name: d.name, mxik: d.mxik, unit: d.unit } });
    }
    await tx.purchaseList.update({ where: { id: listId }, data: { columnMap: map, status: 'ready' } });
  }, { timeout: 120_000 });
  await recheckClientPurchases(orgId, list.clientId);
  return { codes: new Set(derived.flatMap((d) => (d.mxik ? [d.mxik] : []))).size };
}

export async function deletePurchaseList(orgId: string, listId: string): Promise<boolean> {
  const list = await db.purchaseList.findFirst({ where: { id: listId, orgId }, select: { clientId: true } });
  if (!list) return false;
  await db.purchaseList.delete({ where: { id: listId } });
  await recheckClientPurchases(orgId, list.clientId);
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
 * Without any ready purchase list nothing can be concluded, so none remain.
 * Rows where the reviewer already decided a NOT_PURCHASED finding are left alone.
 */
export async function runPurchaseCheck(catalogId: string): Promise<number> {
  const catalog = await db.catalog.findUnique({
    where: { id: catalogId },
    select: { clientId: true, client: { select: { activity: true } } },
  });
  if (!catalog?.clientId) return 0;
  await db.finding.deleteMany({ where: { item: { catalogId }, type: 'NOT_PURCHASED', decision: 'pending' } });

  const purchases = await db.purchaseItem.findMany({
    where: { list: { clientId: catalog.clientId, status: 'ready' } },
    select: { mxik: true, unit: true },
  });
  if (purchases.length === 0) return 0;
  const index = buildPurchaseIndex(purchases);
  const activity = catalog.client?.activity ?? 'boshqa';

  const items = await db.catalogItem.findMany({
    where: { catalogId },
    select: {
      id: true, existingMxik: true, unit: true,
      findings: { select: { type: true, decision: true, chosenMxik: true, decidedAt: true } },
    },
  });
  const rows = items.flatMap((item) => {
    if (item.findings.some((f) => f.type === 'NOT_PURCHASED')) return [];
    // Judge the code the row will carry: an accepted correction wins over the file's.
    const accepted = item.findings
      .filter((f) => f.decision === 'accepted' && f.chosenMxik)
      .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0];
    const finding = checkPurchased({ code: accepted?.chosenMxik ?? item.existingMxik, unit: item.unit }, index, activity);
    return finding ? findingData(item.id, [finding]) : [];
  });
  for (let i = 0; i < rows.length; i += CHUNK) await db.finding.createMany({ data: rows.slice(i, i + CHUNK) });
  return rows.length;
}
