// Cheque lists (the tax cabinet's wrong-MXIK list) and sales exports: stored
// like a catalogue, mapped by the user, then grouped and checked in the background.
// Every function is scoped by org; nothing here edits a catalogue.
import { z } from 'zod';
import { buildPurchaseIndex, checkPurchased } from '../core/audit/purchases.js';
import { readCode } from '../core/audit/checks.js';
import { normalizeName } from '../core/normalize/index.js';
import { resolveUnit } from '../core/normalize/units.js';
import { auditContext, checkItem } from './audit-runner.js';
import { parseAmount } from './catalog-import.js';
import { db } from './db.js';
import type { ParseResult } from './spreadsheet.js';

export type DocKind = 'cheques' | 'sales';
export const DOC_KINDS: DocKind[] = ['cheques', 'sales'];

export const DocMapSchema = z.object({
  name: z.number().int().min(-1),
  mxik: z.number().int().min(0),
  unit: z.number().int().min(-1),
  quantity: z.number().int().min(-1),
  amount: z.number().int().min(-1),
  date: z.number().int().min(-1),
});
export type DocMap = z.infer<typeof DocMapSchema>;

const HINTS: Record<keyof DocMap, string[]> = {
  name: ['nom', 'tovar', 'mahsulot', 'наимен', 'товар', 'name', 'product'],
  mxik: ['mxik', 'ikpu', 'мхик', 'икпу', 'spic', 'kod'],
  unit: ['birlik', 'oʻlchov', 'olchov', 'единиц', 'изм', 'unit'],
  quantity: ['miqdor', 'soni', 'количеств', 'кол-во', 'qty', 'quantity', 'count'],
  amount: ['summa', 'сумм', 'amount', 'total', 'jami', 'итого'],
  date: ['sana', 'дата', 'date', 'vaqt', 'time'],
};

export function guessDocMap(headers: readonly string[]): DocMap {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (field: keyof DocMap): number => lower.findIndex((h) => HINTS[field].some((hint) => h.includes(hint)));
  const map = { name: find('name'), mxik: find('mxik'), unit: find('unit'), quantity: find('quantity'), amount: find('amount'), date: find('date') };
  return { ...map, mxik: Math.max(0, map.mxik) };
}

const Original = z.object({ original: z.array(z.string()) });
const cell = (row: readonly string[], i: number): string | null => (i < 0 ? null : row[i]?.trim() || null);
const CHUNK = 1000;

/** dd.mm.yyyy, dd/mm/yyyy or yyyy-mm-dd; anything else is no date. */
export function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(raw);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCMonth() === Number(m) - 1 ? date : null;
}

export async function storeDocList(input: { orgId: string; clientId: string; kind: DocKind; filename: string; parsed: ParseResult }): Promise<{ listId: string; map: DocMap }> {
  const map = guessDocMap(input.parsed.headers);
  const list = await db.docList.create({
    data: { orgId: input.orgId, clientId: input.clientId, kind: input.kind, filename: input.filename, rowCount: input.parsed.rows.length, headers: input.parsed.headers, columnMap: map },
  });
  for (let i = 0; i < input.parsed.rows.length; i += CHUNK) {
    await db.docItem.createMany({ data: input.parsed.rows.slice(i, i + CHUNK).map((row, j) => ({ listId: list.id, rowIndex: i + j, attrs: { original: [...row] } })) });
  }
  return { listId: list.id, map };
}

const running = new Set<string>();

/** Applies the confirmed mapping and starts the check in the background. */
export async function applyDocMap(orgId: string, listId: string, map: DocMap): Promise<boolean> {
  const list = await db.docList.findFirst({ where: { id: listId, orgId }, select: { id: true } });
  if (!list) return false;
  const items = await db.docItem.findMany({ where: { listId }, select: { id: true, attrs: true } });
  await db.$transaction(async (tx) => {
    for (const item of items) {
      const row = Original.safeParse(item.attrs).data?.original ?? [];
      const code = readCode(cell(row, map.mxik));
      const quantity = parseAmount(cell(row, map.quantity));
      const amount = parseAmount(cell(row, map.amount));
      await tx.docItem.update({
        where: { id: item.id },
        data: { name: cell(row, map.name), mxik: code, unit: cell(row, map.unit), quantity, amount, occurredAt: parseDate(cell(row, map.date)) },
      });
    }
    await tx.docList.update({ where: { id: listId }, data: { columnMap: map, status: 'analyzing', progressDone: 0, error: null } });
  }, { timeout: 300_000 });
  launch(listId);
  return true;
}

export function launch(listId: string): void {
  if (running.has(listId)) return;
  running.add(listId);
  void runDocCheck(listId)
    .catch(async (error: unknown) => {
      await db.docList.update({ where: { id: listId }, data: { status: 'failed', error: error instanceof Error ? error.message : String(error) } }).catch(() => undefined);
    })
    .finally(() => running.delete(listId));
}

type Acc = { key: string; mxik: string | null; unit: string | null; names: Map<string, number>; lines: number; quantity: number; amount: number; hasQty: boolean; hasAmount: boolean };
export type GroupDetail = {
  reasons: string[];
  alternatives: { code: string; name: string; confidence: number }[];
  catalogMatches: { rowIndex: number; name: string; catalogId: string }[];
};

const MAX_GROUPS = 5000;
const PARALLEL = 4;

function groupKey(kind: DocKind, item: { name: string | null; mxik: string | null; unit: string | null }): string {
  const unit = resolveUnit(item.unit)?.id ?? item.unit?.toLowerCase() ?? '';
  const folded = kind === 'cheques' && item.name ? normalizeName(item.name).sortedKey : '';
  return `${item.mxik ?? ''}|${unit}|${folded}`;
}

/** Groups the lines, checks each group once and stores the result. */
export async function runDocCheck(listId: string): Promise<void> {
  const list = await db.docList.findUnique({ where: { id: listId }, include: { client: { select: { activity: true } } } });
  if (!list) return;
  const kind: DocKind = list.kind === 'sales' ? 'sales' : 'cheques';

  const groups = new Map<string, Acc>();
  let cursor = 0;
  for (;;) {
    const page = await db.docItem.findMany({ where: { listId, rowIndex: { gte: cursor, lt: cursor + 5000 } }, select: { name: true, mxik: true, unit: true, quantity: true, amount: true } });
    if (page.length === 0 && cursor >= list.rowCount) break;
    for (const it of page) {
      const key = groupKey(kind, it);
      const acc = groups.get(key) ?? { key, mxik: it.mxik, unit: it.unit, names: new Map<string, number>(), lines: 0, quantity: 0, amount: 0, hasQty: false, hasAmount: false };
      acc.lines += 1;
      if (it.name) acc.names.set(it.name, (acc.names.get(it.name) ?? 0) + 1);
      if (it.quantity !== null) { acc.quantity += Number(it.quantity); acc.hasQty = true; }
      if (it.amount !== null) { acc.amount += Number(it.amount); acc.hasAmount = true; }
      groups.set(key, acc);
    }
    cursor += 5000;
  }

  const ordered = [...groups.values()].sort((a, b) => b.amount - a.amount || b.lines - a.lines).slice(0, MAX_GROUPS);
  await db.docList.update({ where: { id: listId }, data: { progressTotal: ordered.length, progressDone: 0 } });
  await db.docGroup.deleteMany({ where: { listId } });

  const ctx = await auditContext(list.orgId);
  const catalog = await db.catalog.findFirst({ where: { orgId: list.orgId, clientId: list.clientId, status: 'ready' }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  const catalogCodes = catalog ? new Set((await db.catalogItem.findMany({ where: { catalogId: catalog.id, existingMxik: { not: null } }, select: { existingMxik: true } })).flatMap((i) => (i.existingMxik ? [i.existingMxik] : []))) : null;
  const purchases = kind === 'sales' ? await db.purchaseItem.findMany({ where: { list: { clientId: list.clientId, status: 'ready' } }, select: { mxik: true, unit: true } }) : [];
  const purchaseIndex = purchases.length > 0 ? buildPurchaseIndex(purchases) : null;

  let done = 0;
  for (let i = 0; i < ordered.length; i += PARALLEL) {
    const batch = ordered.slice(i, i + PARALLEL);
    const rows = await Promise.all(batch.map(async (g) => {
      const topNames = [...g.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
      const name = topNames[0] ?? null;
      const issues: string[] = [];
      const detail: GroupDetail = { reasons: [], alternatives: [], catalogMatches: [] };
      let suggested: string | null = null;
      let confidence: number | null = null;

      if (!g.mxik) issues.push('MISSING_CODE');
      if (name || g.mxik) {
        const check = await checkItem({ rawName: name ?? '', barcode: null, existingMxik: g.mxik, unit: g.unit }, ctx);
        for (const f of check.findings) {
          if (f.type === 'NOT_FOUND') issues.push('INVALID_CODE');
          else if (f.type === 'MISSING' && g.mxik) issues.push('MISSING_CODE');
          else if (f.type === 'MISMATCH') issues.push('MISMATCH');
          else if (f.type === 'UNIT_CONFLICT') issues.push('UNIT_CONFLICT');
          else continue;
          detail.reasons.push(f.reason);
          if (!suggested && f.suggestedMxik && f.suggestedMxik !== g.mxik) { suggested = f.suggestedMxik; confidence = f.confidence; }
          if (detail.alternatives.length === 0) detail.alternatives = f.alternatives.slice(0, 3).map((a) => ({ code: a.code, name: a.name, confidence: a.confidence }));
        }
      }
      if (kind === 'sales' && g.mxik) {
        if (catalogCodes && !catalogCodes.has(g.mxik)) issues.push('NOT_IN_CATALOG');
        if (purchaseIndex) {
          const bought = checkPurchased({ code: g.mxik, unit: g.unit }, purchaseIndex, list.client.activity);
          if (bought) { issues.push('NOT_PURCHASED'); detail.reasons.push(bought.reason); }
        }
      }
      if (catalog && issues.length > 0) {
        const matchKey = name ? normalizeName(name).matchKey : null;
        const found = await db.catalogItem.findMany({
          where: { catalogId: catalog.id, OR: [...(matchKey ? [{ normalizedName: matchKey }] : []), ...(g.mxik ? [{ existingMxik: g.mxik }] : [])] },
          orderBy: { rowIndex: 'asc' }, take: 3, select: { rowIndex: true, rawName: true },
        });
        detail.catalogMatches = found.map((f) => ({ rowIndex: f.rowIndex, name: f.rawName, catalogId: catalog.id }));
      }
      return {
        listId, name, names: topNames, mxik: g.mxik, unit: g.unit, lines: g.lines,
        quantity: g.hasQty ? g.quantity : null, amount: g.hasAmount ? g.amount : null,
        issues: [...new Set(issues)], suggestedMxik: suggested, confidence, detail,
      };
    }));
    await db.docGroup.createMany({ data: rows });
    done += batch.length;
    await db.docList.update({ where: { id: listId }, data: { progressDone: done } });
  }
  await db.docList.update({ where: { id: listId }, data: { status: 'ready' } });
  await db.auditEvent.create({ data: { orgId: list.orgId, actorId: null, action: `${kind}.checked`, targetId: listId, payload: { clientId: list.clientId, groups: ordered.length, truncated: groups.size > MAX_GROUPS } } });
}

export async function deleteDocList(orgId: string, listId: string): Promise<boolean> {
  const done = await db.docList.deleteMany({ where: { id: listId, orgId } });
  return done.count > 0;
}
