// Cheque lists (the tax cabinet's wrong-MXIK list) and sales exports: stored
// like a catalogue, mapped by the user, then grouped and checked in the
// background with a heartbeat, so a check whose worker died can be restarted.
// Every function is scoped by org and client; nothing here edits a catalogue.
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { buildPurchaseIndex, checkPurchased } from '@tasnivo/core/audit/purchases';
import { readCode } from '@tasnivo/core/audit/checks';
import { normalizeName } from '@tasnivo/core/normalize/index';
import { resolveUnit } from '@tasnivo/core/normalize/units';
import { canSeeClient } from './access.js';
import { readAmount } from './amount.js';
import { auditContext, checkItem } from './audit-runner.js';
import { db } from '@tasnivo/db';
import { jobs } from './jobs/dispatcher.js';
import { InlineDispatcher } from './jobs/inline.js';
import { listMeta, type ListActor } from './purchases.js';
import type { ParseResult } from './spreadsheet.js';
import { mayWrite } from './write-access.js';

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

/** DocList.meta: resume sample, reader limits, ambiguous amounts, group totals and the worker's heartbeat. */
const DocMetaSchema = z.object({
  sample: z.array(z.array(z.string())).optional(),
  totalSeen: z.number().optional(),
  truncated: z.boolean().optional(),
  ambiguous: z.number().optional(),
  groupsTotal: z.number().optional(),
  groupsChecked: z.number().optional(),
  heartbeatAt: z.string().optional(),
});
export type DocMeta = z.infer<typeof DocMetaSchema>;
export const readDocMeta = (json: unknown): DocMeta => DocMetaSchema.safeParse(json).data ?? {};
const asJson = (meta: DocMeta): Prisma.InputJsonValue => meta;

const Original = z.object({ original: z.array(z.string()) });
const cell = (row: readonly string[], i: number): string | null => (i < 0 ? null : row[i]?.trim() || null);
const CHUNK = 1000;
const UPDATE_CHUNK = 5000;
/** Without a heartbeat for this long, an "analyzing" list is presumed orphaned. */
export const DOC_STALE_MS = 120_000;

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

/** True when an "analyzing" list has not reported progress for a while. */
export function docCheckStale(list: { status: string; meta: unknown; createdAt: Date }, now = new Date()): boolean {
  if (list.status !== 'analyzing') return false;
  const beat = readDocMeta(list.meta).heartbeatAt;
  const last = beat ? new Date(beat).getTime() : list.createdAt.getTime();
  return now.getTime() - last > DOC_STALE_MS;
}

export async function storeDocList(actor: ListActor, input: { clientId: string; kind: DocKind; filename: string; parsed: ParseResult }): Promise<{ listId: string; map: DocMap } | null> {
  if (!mayWrite(actor)) return null;
  // An archived client takes no new files.
  const client = await db.client.findFirst({ where: { id: input.clientId, orgId: actor.orgId, archivedAt: null }, select: { id: true } });
  if (!client || !canSeeClient(actor, client.id)) return null;
  const map = guessDocMap(input.parsed.headers);
  const listId = await db.$transaction(async (tx) => {
    const list = await tx.docList.create({
      data: {
        orgId: actor.orgId, clientId: client.id, kind: input.kind, filename: input.filename, rowCount: input.parsed.rows.length,
        headers: input.parsed.headers, columnMap: map, meta: asJson(listMeta(input.parsed)),
      },
    });
    for (let i = 0; i < input.parsed.rows.length; i += CHUNK) {
      await tx.docItem.createMany({ data: input.parsed.rows.slice(i, i + CHUNK).map((row, j) => ({ listId: list.id, rowIndex: i + j, attrs: { original: [...row] } })) });
    }
    await tx.auditEvent.create({
      data: {
        orgId: actor.orgId, actorId: actor.userId, action: `${input.kind}.uploaded`, targetId: list.id,
        payload: { clientId: client.id, listId: list.id, filename: input.filename, rowCount: input.parsed.rows.length, truncated: input.parsed.truncated },
      },
    });
    return list.id;
  }, { timeout: 180_000 });
  return { listId, map };
}

/** A list the actor may change: in the org, of a client they may open, and not as a viewer. */
async function ownDocList(actor: ListActor, listId: string) {
  if (!mayWrite(actor)) return null;
  const list = await db.docList.findFirst({ where: { id: listId, orgId: actor.orgId }, select: { id: true, clientId: true, kind: true, filename: true, status: true, meta: true, createdAt: true } });
  return list && canSeeClient(actor, list.clientId) ? list : null;
}

/** Applies the confirmed mapping and starts (or queues) the check in the background. */
export async function applyDocMap(actor: ListActor, listId: string, map: DocMap): Promise<boolean> {
  const list = await ownDocList(actor, listId);
  if (!list || list.status === 'analyzing') return false;
  await writeDocMap(listId, map, list.meta);
  await jobs().enqueueDocCheck(listId);
  return true;
}

/** Derives every line under the mapping (one bulk update per chunk) and marks the list as being checked. */
export async function writeDocMap(listId: string, map: DocMap, previousMeta: unknown): Promise<DocMeta> {
  const items = await db.docItem.findMany({ where: { listId }, select: { id: true, attrs: true } });
  let ambiguous = 0;
  const derived = items.map((item) => {
    const row = Original.safeParse(item.attrs).data?.original ?? [];
    const quantity = readAmount(cell(row, map.quantity));
    const amount = readAmount(cell(row, map.amount));
    if (quantity.ambiguous || amount.ambiguous) ambiguous++;
    return {
      id: item.id, name: cell(row, map.name), mxik: readCode(cell(row, map.mxik)), unit: cell(row, map.unit),
      quantity: quantity.value, amount: amount.value, date: parseDate(cell(row, map.date))?.toISOString().slice(0, 10) ?? null,
    };
  });
  const meta: DocMeta = { ...readDocMeta(previousMeta), ambiguous, heartbeatAt: new Date().toISOString() };
  await db.$transaction(async (tx) => {
    for (let i = 0; i < derived.length; i += UPDATE_CHUNK) {
      const part = derived.slice(i, i + UPDATE_CHUNK);
      // Numbers and dates travel as text and are cast per element: a numeric[] parameter is not sent reliably.
      const text = (v: number | null): string | null => (v === null ? null : String(v));
      await tx.$executeRaw`
        UPDATE doc_item d SET name = v.name, mxik = v.mxik, unit = v.unit,
          quantity = v.quantity::numeric, amount = v.amount::numeric, "occurredAt" = v.day::date
        FROM unnest(${part.map((p) => p.id)}::text[], ${part.map((p) => p.name)}::text[], ${part.map((p) => p.mxik)}::text[],
                    ${part.map((p) => p.unit)}::text[], ${part.map((p) => text(p.quantity))}::text[], ${part.map((p) => text(p.amount))}::text[],
                    ${part.map((p) => p.date)}::text[]) AS v(id, name, mxik, unit, quantity, amount, day)
        WHERE d.id = v.id`;
    }
    await tx.docList.update({ where: { id: listId }, data: { columnMap: map, status: 'analyzing', progressDone: 0, progressTotal: 0, error: null, meta: asJson(meta) } });
  }, { timeout: 300_000 });
  return meta;
}

/** Restarts a failed check, or one whose worker stopped reporting. */
export async function restartDocCheck(actor: ListActor, listId: string): Promise<boolean> {
  const list = await ownDocList(actor, listId);
  if (!list) return false;
  if (list.status !== 'failed' && !(docCheckStale(list) && !docCheckRunningHere(listId))) return false;
  await db.docList.update({
    where: { id: listId },
    data: { status: 'analyzing', progressDone: 0, error: null, meta: asJson({ ...readDocMeta(list.meta), heartbeatAt: new Date().toISOString() }) },
  });
  await jobs().enqueueDocCheck(listId);
  return true;
}

/** Whether this process runs the check (JOBS_MODE=inline); a queued check is judged by its heartbeat alone. */
function docCheckRunningHere(listId: string): boolean {
  const dispatcher = jobs();
  return dispatcher instanceof InlineDispatcher && dispatcher.docCheckRunning(listId);
}

/** How a check that threw ends: "failed", with the reason only in the server log (the page shows a localized message). */
export async function markDocCheckFailed(listId: string, error: unknown): Promise<void> {
  console.warn(`[doc check ${listId}] failed: ${error instanceof Error ? error.message : String(error)}`);
  await db.docList.update({ where: { id: listId }, data: { status: 'failed', error: null } }).catch(() => undefined);
}

type Acc = { key: string; mxik: string | null; unit: string | null; names: Map<string, number>; lines: number; quantity: number; amount: number; hasQty: boolean; hasAmount: boolean };
export type GroupDetail = {
  reasons: string[];
  alternatives: { code: string; name: string; confidence: number }[];
  catalogMatches: { rowIndex: number; name: string; catalogId: string }[];
};

export const MAX_GROUPS = 5000;
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
  const meta: DocMeta = readDocMeta(list.meta);
  const beat = async (data: { progressDone?: number; progressTotal?: number } = {}): Promise<void> => {
    meta.heartbeatAt = new Date().toISOString();
    await db.docList.update({ where: { id: listId }, data: { ...data, meta: asJson(meta) } });
  };

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
  meta.groupsTotal = groups.size;
  meta.groupsChecked = ordered.length;
  await beat({ progressTotal: ordered.length, progressDone: 0 });
  await db.docGroup.deleteMany({ where: { listId } });

  const ctx = await auditContext(list.orgId);
  const catalog = await db.catalog.findFirst({ where: { orgId: list.orgId, clientId: list.clientId, status: 'ready' }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  const catalogCodes = catalog ? new Set((await db.catalogItem.findMany({ where: { catalogId: catalog.id, existingMxik: { not: null } }, select: { existingMxik: true } })).flatMap((i) => (i.existingMxik ? [i.existingMxik] : []))) : null;
  const purchases = kind === 'sales' ? await db.purchaseItem.findMany({ where: { list: { clientId: list.clientId, status: 'ready' }, mxik: { not: null } }, select: { mxik: true, unit: true } }) : [];
  const built = buildPurchaseIndex(purchases);
  // A purchase list without a single valid code says nothing about what was bought.
  const purchaseIndex = built.size > 0 ? built : null;

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
    await beat({ progressDone: done });
  }
  await db.docList.update({ where: { id: listId }, data: { status: 'ready', meta: asJson(meta) } });
  await db.auditEvent.create({
    data: {
      orgId: list.orgId, actorId: null, action: `${kind}.checked`, targetId: listId,
      payload: { clientId: list.clientId, listId, groups: ordered.length, groupsTotal: groups.size, truncated: groups.size > MAX_GROUPS },
    },
  });
}

export async function deleteDocList(actor: ListActor, listId: string): Promise<boolean> {
  const list = await ownDocList(actor, listId);
  if (!list) return false;
  const kind = list.kind === 'sales' ? 'sales' : 'cheques';
  const [done] = await db.$transaction([
    db.docList.deleteMany({ where: { id: listId, orgId: actor.orgId } }),
    db.auditEvent.create({
      data: { orgId: actor.orgId, actorId: actor.userId, action: `${kind}.deleted`, targetId: listId, payload: { clientId: list.clientId, listId, filename: list.filename } },
    }),
  ]);
  return done.count > 0;
}
