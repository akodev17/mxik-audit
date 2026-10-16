// Review decisions: record, bulk-accept, undo, history. Every function takes the
// acting user and scopes every query by their org. The audit log stays
// append-only: undo writes a new event and never edits or deletes an old one.
import { BANDS } from '../core/match/score.js';
import { catalogScope } from './access.js';
import { learnQuietly } from './dictionary.js';
import { db } from './db.js';

export type Actor = { userId: string; orgId: string; clientIds?: string[] | null };
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const DECISION_ACTIONS = ['finding.accepted', 'finding.rejected', 'finding.bulk_accepted'] as const;
const HISTORY_ACTIONS = [...DECISION_ACTIONS, 'finding.undone'];

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** True when the code is a live classifier code. Nothing else may be accepted. */
async function isLiveCode(code: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ ok: number }[]>`
    SELECT 1 AS ok FROM mxik_code WHERE code = ${code} AND "retiredAt" IS NULL LIMIT 1`;
  return rows.length > 0;
}

export async function recordDecision(
  actor: Actor,
  input: { findingId: string; decision: 'accepted' | 'rejected'; chosenMxik?: string | null; groupSize?: number },
): Promise<Result<{ eventId: string }>> {
  const finding = await db.finding.findFirst({
    where: { id: input.findingId, item: { catalog: catalogScope(actor) } },
    select: { id: true, suggestedMxik: true, type: true, decision: true, item: { select: { rawName: true, catalogId: true, unit: true, barcode: true } } },
  });
  if (!finding) return fail('not found');
  // A decided row must be undone first, so no decision is ever overwritten silently.
  if (finding.decision !== 'pending') return fail('already decided');

  const chosen = input.decision === 'accepted' ? (input.chosenMxik ?? finding.suggestedMxik) : null;
  if (input.decision === 'accepted' && (!chosen || !(await isLiveCode(chosen)))) return fail('code not in classifier');

  try {
    const eventId = await db.$transaction(async (tx) => {
      // This record is the long-term asset: a product-name-to-verified-code
      // dataset, and what a client shows an inspector as due diligence.
      const event = await tx.auditEvent.create({
        data: {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: `finding.${input.decision}`,
          targetId: finding.id,
          payload: {
            catalogId: finding.item.catalogId,
            type: finding.type,
            productName: finding.item.rawName,
            suggestedMxik: finding.suggestedMxik,
            chosenMxik: chosen,
            overrodeSuggestion: chosen !== null && chosen !== finding.suggestedMxik,
            ...(input.groupSize ? { groupSize: input.groupSize } : {}),
          },
        },
      });
      const updated = await tx.finding.updateMany({
        where: { id: finding.id, decision: 'pending' },
        data: {
          decision: input.decision, chosenMxik: chosen, decidedBy: actor.userId,
          decidedAt: event.createdAt, decisionEventId: event.id,
        },
      });
      // Someone else decided it in the meantime: roll the event back too.
      if (updated.count !== 1) throw new Error('already decided');
      return event.id;
    });
    // Accepting teaches the firm dictionary; a later row with the same product reuses it.
    if (chosen) await learnQuietly(actor.orgId, actor.userId, [{ rawName: finding.item.rawName, unit: finding.item.unit, barcode: finding.item.barcode, code: chosen }]);
    return { ok: true, eventId };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'failed');
  }
}

/**
 * One decision for a group of similar rows. Each row still gets its own audit
 * event, so every row's history reads exactly as if decided alone.
 */
export async function recordGroupDecision(
  actor: Actor,
  input: { findingIds: string[]; decision: 'accepted' | 'rejected' },
): Promise<Result<{ decided: { findingId: string; eventId: string }[] }>> {
  const decided: { findingId: string; eventId: string }[] = [];
  for (const findingId of input.findingIds) {
    const result = await recordDecision(actor, { findingId, decision: input.decision, groupSize: input.findingIds.length });
    if (result.ok) decided.push({ findingId, eventId: result.eventId });
  }
  return decided.length > 0 ? { ok: true, decided } : fail('nothing decided');
}

/** Takes one row out of its group, so it is reviewed on its own. */
export async function splitFromGroup(actor: Actor, findingId: string): Promise<Result> {
  const finding = await db.finding.findFirst({
    where: { id: findingId, item: { catalog: catalogScope(actor) } },
    select: { id: true, item: { select: { catalogId: true, rawName: true } } },
  });
  if (!finding) return fail('not found');
  await db.$transaction([
    db.finding.update({ where: { id: finding.id }, data: { groupSplit: true } }),
    db.auditEvent.create({
      data: {
        orgId: actor.orgId, actorId: actor.userId, action: 'finding.split_from_group', targetId: finding.id,
        payload: { catalogId: finding.item.catalogId, productName: finding.item.rawName },
      },
    }),
  ]);
  return { ok: true };
}

/** "Accept all above 90%." Only pending findings with a suggestion, high band only. */
export async function bulkAccept(
  actor: Actor,
  input: { catalogId: string; minConfidence: number },
): Promise<Result<{ count: number; eventId: string | null }>> {
  if (input.minConfidence < BANDS.high) return fail('threshold below the high band');
  const catalog = await db.catalog.findFirst({ where: { id: input.catalogId, ...catalogScope(actor) }, select: { id: true } });
  if (!catalog) return fail('not found');

  const targets = await db.finding.findMany({
    where: {
      item: { catalogId: catalog.id },
      decision: 'pending',
      confidence: { gte: input.minConfidence },
      suggestedMxik: { not: null },
    },
    select: { id: true, suggestedMxik: true, confidence: true, item: { select: { rawName: true, unit: true, barcode: true } } },
  });
  if (targets.length === 0) return { ok: true, count: 0, eventId: null };

  const eventId = await db.$transaction(async (tx) => {
    const event = await tx.auditEvent.create({
      data: {
        orgId: actor.orgId,
        actorId: actor.userId,
        action: 'finding.bulk_accepted',
        targetId: catalog.id,
        payload: {
          catalogId: catalog.id,
          minConfidence: input.minConfidence,
          count: targets.length,
          findings: targets.map((f) => ({
            id: f.id, productName: f.item.rawName, chosenMxik: f.suggestedMxik, confidence: f.confidence,
          })),
        },
      },
    });
    const ids = targets.map((f) => f.id);
    await tx.$executeRaw`
      UPDATE finding SET decision = 'accepted'::decision, "chosenMxik" = "suggestedMxik",
        "decidedBy" = ${actor.userId}, "decidedAt" = ${event.createdAt}, "decisionEventId" = ${event.id}
      WHERE id = ANY(${ids}) AND decision = 'pending'::decision`;
    return event.id;
  }, { timeout: 120_000 });

  await learnQuietly(actor.orgId, actor.userId, targets.flatMap((f) => (f.suggestedMxik ? [{ rawName: f.item.rawName, unit: f.item.unit, barcode: f.item.barcode, code: f.suggestedMxik }] : [])));
  return { ok: true, count: targets.length, eventId };
}

/**
 * Reverts the findings an earlier decision event set, back to pending, and
 * appends a `finding.undone` event. Only findings still carrying that event's
 * decision are touched, so undoing twice is a no-op error, not a corruption.
 * `onlyFindingId` narrows a bulk event to one row.
 */
export async function undoDecision(
  actor: Actor,
  eventId: string,
  onlyFindingId?: string,
): Promise<Result<{ findingIds: string[] }>> {
  const event = await db.auditEvent.findFirst({
    where: { id: eventId, orgId: actor.orgId, action: { in: [...DECISION_ACTIONS] } },
    select: { id: true, action: true, payload: true },
  });
  if (!event) return fail('not found');

  const findings = await db.finding.findMany({
    where: {
      decisionEventId: event.id,
      item: { catalog: catalogScope(actor) },
      ...(onlyFindingId ? { id: onlyFindingId } : {}),
    },
    select: { id: true, decision: true, chosenMxik: true, item: { select: { rawName: true, catalogId: true } } },
  });
  if (findings.length === 0) return fail('already undone');

  const ids = findings.map((f) => f.id);
  try {
    await db.$transaction(async (tx) => {
      const reverted = await tx.finding.updateMany({
        where: { id: { in: ids }, decisionEventId: event.id },
        data: { decision: 'pending', chosenMxik: null, decidedBy: null, decidedAt: null, decisionEventId: null },
      });
      if (reverted.count === 0) throw new Error('already undone');
      await tx.auditEvent.create({
        data: {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: 'finding.undone',
          targetId: event.id,
          payload: {
            catalogId: findings[0]?.item.catalogId ?? null,
            undoneEventId: event.id,
            undoneAction: event.action,
            findings: findings.map((f) => ({
              id: f.id, productName: f.item.rawName, previousDecision: f.decision, previousChosenMxik: f.chosenMxik,
            })),
          },
        },
      });
    }, { timeout: 120_000 });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'failed');
  }
  return { ok: true, findingIds: ids };
}

/** Undoes the most recent decision in this catalogue that is still in effect. */
export async function undoLast(actor: Actor, catalogId: string): Promise<Result<{ findingIds: string[] }>> {
  const recent = await db.auditEvent.findMany({
    where: { orgId: actor.orgId, action: { in: [...DECISION_ACTIONS] }, payload: { path: ['catalogId'], equals: catalogId } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true },
  });
  const live = await liveEventIds(recent.map((e) => e.id));
  const target = recent.find((e) => live.has(e.id));
  return target ? undoDecision(actor, target.id) : fail('nothing to undo');
}

/** Decision events whose decision is still on at least one finding. */
async function liveEventIds(eventIds: string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const rows = await db.finding.groupBy({ by: ['decisionEventId'], where: { decisionEventId: { in: eventIds } } });
  return new Set(rows.flatMap((r) => (r.decisionEventId ? [r.decisionEventId] : [])));
}

export type HistoryEntry = {
  id: string;
  action: string;
  createdAt: Date;
  actorEmail: string | null;
  /** Single decisions name the product; bulk and undo events give a count. */
  productName: string | null;
  chosenMxik: string | null;
  count: number;
  undoable: boolean;
};

export async function decisionHistory(actor: Actor, catalogId: string, limit = 50): Promise<HistoryEntry[]> {
  const events = await db.auditEvent.findMany({
    where: { orgId: actor.orgId, action: { in: HISTORY_ACTIONS }, payload: { path: ['catalogId'], equals: catalogId } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, action: true, createdAt: true, actorId: true, payload: true },
  });
  const live = await liveEventIds(events.map((e) => e.id));
  const actorIds = [...new Set(events.flatMap((e) => (e.actorId ? [e.actorId] : [])))];
  const users = await db.user.findMany({ where: { id: { in: actorIds }, orgId: actor.orgId }, select: { id: true, email: true } });
  const emailOf = new Map(users.map((u) => [u.id, u.email]));

  return events.map((e) => {
    const p = (typeof e.payload === 'object' && e.payload !== null ? e.payload : {}) as Record<string, unknown>;
    const findings = Array.isArray(p['findings']) ? p['findings'] : null;
    return {
      id: e.id,
      action: e.action,
      createdAt: e.createdAt,
      actorEmail: e.actorId ? emailOf.get(e.actorId) ?? null : null,
      productName: typeof p['productName'] === 'string' ? p['productName'] : null,
      chosenMxik: typeof p['chosenMxik'] === 'string' ? p['chosenMxik'] : null,
      count: findings ? findings.length : 1,
      undoable: live.has(e.id),
    };
  });
}
