// Bulk actions on selected findings or on a whole filter: accept suggestions
// (or confirm current codes), assign one code, reject, or flag. One audit event
// per action, so a single undo reverts it; flag changes keep each row's
// previous flag for the same reason.
import { randomUUID } from 'node:crypto';
import { readEvidence } from '../core/match/evidence.js';
import { catalogScope } from './access.js';
import { decideMany, liveCodeSet, type ManyDone, type ManyTarget } from './decide-many.js';
import { db } from './db.js';
import type { Actor, Result } from './decisions.js';
import { acceptCode } from './finding-kinds.js';
import { workspaceAllIds, workspaceCount } from './workspace.js';
import { pendingSubset, type WsFilter } from './workspace-filter.js';
import { mayWrite } from './write-access.js';

export type Flag = 'ask_client' | 'resolved' | null;

export type BulkAction =
  | { kind: 'accept' }
  | { kind: 'reject' }
  | { kind: 'assign'; code: string }
  | { kind: 'flag'; flag: Flag };

export type BulkTarget = { ids: string[] } | { filter: WsFilter };

export const BULK_LIMIT = 20_000;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export type BulkDone = ManyDone;

async function scopedCatalog(actor: Actor, catalogId: string): Promise<string | null> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, ...catalogScope(actor) }, select: { id: true } });
  return catalog?.id ?? null;
}

/** Decisions only ever touch pending rows; flags touch every row of the filter. */
function effectiveFilter(target: { filter: WsFilter }, action: BulkAction): WsFilter | null {
  return action.kind === 'flag' ? target.filter : pendingSubset(target.filter);
}

export type BulkPreview = { willTouch: number; matching: number; capped: boolean; limit: number };

/** Dry run: how many rows the action would touch, and whether the cap cuts it short. */
export async function bulkPreview(actor: Actor, catalogId: string, target: BulkTarget, action: BulkAction): Promise<Result<BulkPreview>> {
  const id = await scopedCatalog(actor, catalogId);
  if (!id) return fail('not found');
  if ('ids' in target) {
    const matching = await db.finding.count({
      where: { id: { in: target.ids.slice(0, BULK_LIMIT) }, item: { catalogId: id }, ...(action.kind === 'flag' ? {} : { decision: 'pending' }) },
    });
    return { ok: true, willTouch: matching, matching, capped: target.ids.length > BULK_LIMIT, limit: BULK_LIMIT };
  }
  const filter = effectiveFilter(target, action);
  const matching = filter ? await workspaceCount(id, filter) : 0;
  return { ok: true, willTouch: Math.min(matching, BULK_LIMIT), matching, capped: matching > BULK_LIMIT, limit: BULK_LIMIT };
}

async function targetIds(catalogId: string, target: BulkTarget, action: BulkAction): Promise<string[]> {
  if ('ids' in target) return target.ids.slice(0, BULK_LIMIT);
  const filter = effectiveFilter(target, action);
  return filter ? workspaceAllIds(catalogId, filter, BULK_LIMIT) : [];
}

const none = { archived: 0, conflict: 0, noCode: 0 };

export async function bulkApply(actor: Actor, catalogId: string, target: BulkTarget, action: BulkAction): Promise<Result<BulkDone>> {
  if (!mayWrite(actor)) return fail('forbidden');
  const id = await scopedCatalog(actor, catalogId);
  if (!id) return fail('not found');
  const wanted = await targetIds(id, target, action);
  if (wanted.length === 0) return { ok: true, count: 0, eventId: null, ids: [], skipped: none };
  if (action.kind === 'flag') return { ok: true, ...(await applyFlag(actor, id, wanted, action.flag, 'ids' in target ? 'selection' : 'filter')) };
  if (action.kind === 'assign' && !(await liveCodeSet([action.code])).has(action.code)) return fail('code not in classifier');

  const rows = await db.finding.findMany({
    where: { id: { in: wanted }, item: { catalogId: id }, decision: 'pending' },
    select: { id: true, type: true, suggestedMxik: true, evidence: true, item: { select: { id: true, rawName: true, unit: true, barcode: true, existingMxik: true } } },
  });
  const targets: ManyTarget[] = rows.map((r) => ({
    id: r.id, itemId: r.item.id, rawName: r.item.rawName, unit: r.item.unit, barcode: r.item.barcode,
    code: action.kind === 'assign' ? action.code
      : action.kind === 'reject' ? null
        : acceptCode({ type: r.type, suggestedMxik: r.suggestedMxik, existingMxik: r.item.existingMxik, rerankNone: readEvidence(r.evidence)?.rerankNone === true }),
  }));
  const done = await decideMany({
    orgId: actor.orgId, userId: actor.userId, catalogId: id,
    decision: action.kind === 'reject' ? 'rejected' : 'accepted', source: 'bulk',
    payload: { mode: action.kind, scope: 'ids' in target ? 'selection' : 'filter', ...(action.kind === 'assign' ? { chosenMxik: action.code } : {}) },
  }, targets);
  return { ok: true, ...done };
}

/** Sets a flag and records every changed row's previous flag, so the change can be undone. */
async function applyFlag(actor: Actor, catalogId: string, ids: string[], flag: Flag, scope: 'selection' | 'filter'): Promise<BulkDone> {
  const eventId = randomUUID();
  const changed = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; previous: string | null }[]>`
      UPDATE finding f SET flag = ${flag}::text
      FROM (SELECT fi.id, fi.flag AS previous FROM finding fi JOIN catalog_item ci ON ci.id = fi."itemId"
            WHERE fi.id = ANY(${ids}) AND ci."catalogId" = ${catalogId} FOR UPDATE OF fi) o
      WHERE f.id = o.id AND o.previous IS DISTINCT FROM ${flag}::text
      RETURNING f.id, o.previous`;
    if (rows.length === 0) return rows;
    await tx.auditEvent.create({
      data: {
        id: eventId, orgId: actor.orgId, actorId: actor.userId, action: 'finding.flagged', targetId: catalogId,
        payload: { catalogId, flag, count: rows.length, source: 'bulk', scope, findings: rows.map((r) => ({ id: r.id, previous: r.previous })) },
      },
    });
    return rows;
  }, { timeout: 120_000 });
  return changed.length === 0
    ? { count: 0, eventId: null, ids: [], skipped: none }
    : { count: changed.length, eventId, ids: changed.map((r) => r.id), skipped: none };
}

export type FlagUndo = { findingIds: string[]; flags: Record<string, string | null> };

/** Puts back the flags a bulk flag event replaced, on rows nobody re-flagged since. */
export async function undoFlags(actor: Actor, eventId: string): Promise<Result<FlagUndo>> {
  if (!mayWrite(actor)) return fail('forbidden');
  const event = await db.auditEvent.findFirst({ where: { id: eventId, orgId: actor.orgId, action: 'finding.flagged' }, select: { id: true, payload: true } });
  if (!event) return fail('not found');
  const p = (typeof event.payload === 'object' && event.payload !== null ? event.payload : {}) as Record<string, unknown>;
  const flag = typeof p['flag'] === 'string' ? p['flag'] : null;
  const previous = new Map((Array.isArray(p['findings']) ? p['findings'] : []).flatMap((raw): [string, string | null][] => {
    if (typeof raw !== 'object' || raw === null) return [];
    const r = raw as Record<string, unknown>;
    return typeof r['id'] === 'string' ? [[r['id'], typeof r['previous'] === 'string' ? r['previous'] : null]] : [];
  }));
  if (previous.size === 0) return fail('nothing to undo');

  const rows = await db.finding.findMany({
    where: { id: { in: [...previous.keys()] }, flag, item: { catalog: catalogScope(actor) } },
    select: { id: true, item: { select: { catalogId: true } } },
  });
  if (rows.length === 0) return fail('already undone');
  const flags = Object.fromEntries(rows.map((r) => [r.id, previous.get(r.id) ?? null]));
  await db.$transaction(async (tx) => {
    for (const value of new Set(Object.values(flags))) {
      const ids = rows.filter((r) => flags[r.id] === value).map((r) => r.id);
      await tx.finding.updateMany({ where: { id: { in: ids }, flag }, data: { flag: value } });
    }
    await tx.auditEvent.create({
      data: {
        orgId: actor.orgId, actorId: actor.userId, action: 'finding.flag_undone', targetId: event.id,
        payload: { catalogId: rows[0]?.item.catalogId ?? null, undoneEventId: event.id, count: rows.length },
      },
    });
  });
  return { ok: true, findingIds: rows.map((r) => r.id), flags };
}
