// Bulk actions on selected findings: accept suggestions, assign one code,
// reject, or flag. One AuditEvent per action so a single undo reverts it.
import { catalogScope } from './access.js';
import { learnQuietly } from './dictionary.js';
import { db } from './db.js';
import type { Actor, Result } from './decisions.js';
import { workspaceAllIds, type WsFilter } from './workspace.js';

export type BulkAction =
  | { kind: 'accept' }
  | { kind: 'reject' }
  | { kind: 'assign'; code: string }
  | { kind: 'flag'; flag: 'ask_client' | 'resolved' | null };

export type BulkTarget = { ids: string[] } | { filter: WsFilter };

export const BULK_LIMIT = 20_000;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

type BulkDone = { count: number; eventId: string | null; ids: string[] };

export async function bulkApply(actor: Actor, catalogId: string, target: BulkTarget, action: BulkAction): Promise<Result<BulkDone>> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, ...catalogScope(actor) }, select: { id: true } });
  if (!catalog) return fail('not found');

  const wanted = 'ids' in target ? target.ids.slice(0, BULK_LIMIT) : await workspaceAllIds(catalog.id, target.filter, BULK_LIMIT);
  if (wanted.length === 0) return { ok: true, count: 0, eventId: null, ids: [] };

  const rows = await db.finding.findMany({
    where: { id: { in: wanted }, item: { catalogId: catalog.id }, ...(action.kind === 'flag' ? {} : { decision: 'pending' }) },
    select: { id: true, suggestedMxik: true, item: { select: { rawName: true, unit: true, barcode: true } } },
  });

  if (action.kind === 'flag') {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return { ok: true, count: 0, eventId: null, ids: [] };
    await db.$transaction([
      db.finding.updateMany({ where: { id: { in: ids } }, data: { flag: action.flag } }),
      db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'finding.flagged', targetId: catalog.id, payload: { catalogId: catalog.id, flag: action.flag, count: ids.length } } }),
    ]);
    return { ok: true, count: ids.length, eventId: null, ids };
  }

  let targets = rows;
  let code: string | null = null;
  if (action.kind === 'accept') targets = rows.filter((r) => r.suggestedMxik);
  if (action.kind === 'assign') {
    code = action.code;
    const live = await db.mxikCode.findFirst({ where: { code, retiredAt: null }, select: { code: true } });
    if (!live) return fail('code not in classifier');
  }
  if (action.kind === 'accept') {
    // Only live classifier codes may be accepted.
    const codes = [...new Set(targets.map((r) => r.suggestedMxik).filter((c): c is string => c !== null))];
    const live = new Set((await db.$queryRaw<{ code: string }[]>`SELECT code FROM mxik_code WHERE code = ANY(${codes}) AND "retiredAt" IS NULL`).map((r) => r.code.trim()));
    targets = targets.filter((r) => r.suggestedMxik && live.has(r.suggestedMxik));
  }
  if (targets.length === 0) return { ok: true, count: 0, eventId: null, ids: [] };

  const ids = targets.map((r) => r.id);
  const reject = action.kind === 'reject';
  const eventId = await db.$transaction(async (tx) => {
    const event = await tx.auditEvent.create({
      data: {
        orgId: actor.orgId, actorId: actor.userId, action: reject ? 'finding.bulk_rejected' : 'finding.bulk_accepted', targetId: catalog.id,
        payload: { catalogId: catalog.id, source: 'selection', mode: action.kind, count: ids.length, ...(code ? { chosenMxik: code } : {}) },
      },
    });
    if (reject) {
      await tx.$executeRaw`UPDATE finding SET decision = 'rejected'::decision, "chosenMxik" = NULL, "decidedBy" = ${actor.userId}, "decidedAt" = ${event.createdAt}, "decisionEventId" = ${event.id} WHERE id = ANY(${ids}) AND decision = 'pending'::decision`;
    } else if (code) {
      await tx.$executeRaw`UPDATE finding SET decision = 'accepted'::decision, "chosenMxik" = ${code}, "decidedBy" = ${actor.userId}, "decidedAt" = ${event.createdAt}, "decisionEventId" = ${event.id} WHERE id = ANY(${ids}) AND decision = 'pending'::decision`;
    } else {
      await tx.$executeRaw`UPDATE finding SET decision = 'accepted'::decision, "chosenMxik" = "suggestedMxik", "decidedBy" = ${actor.userId}, "decidedAt" = ${event.createdAt}, "decisionEventId" = ${event.id} WHERE id = ANY(${ids}) AND decision = 'pending'::decision`;
    }
    return event.id;
  }, { timeout: 120_000 });

  if (!reject) {
    await learnQuietly(actor.orgId, actor.userId, targets.flatMap((r) => {
      const chosen = code ?? r.suggestedMxik;
      return chosen ? [{ rawName: r.item.rawName, unit: r.item.unit, barcode: r.item.barcode, code: chosen }] : [];
    }));
  }
  return { ok: true, count: ids.length, eventId, ids };
}
