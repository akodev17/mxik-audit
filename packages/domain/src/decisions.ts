// Review decisions: record, group, bulk-accept, undo, history. Every function
// takes the acting user and scopes every query by their org (and assigned
// clients). The audit log stays append-only: undo writes a new event and never
// edits or deletes an old one. One row holds one accepted code: see
// effective-code.ts for the rule.
import { Prisma } from '@prisma/client';
import { readEvidence } from '@tasnivo/core/match/evidence';
import { BANDS } from '@tasnivo/core/match/score';
import { catalogScope } from './access.js';
import { decideMany, liveCodeSet, screenTargets, type ManyDone, type ManyTarget, type Skipped } from './decide-many.js';
import { confirms, learnerOf, learnKeys, learnQuietly, readMappingsBefore, restoreMappings, snapshotMappings, type LearnSource } from './dictionary.js';
import { dictionaryEntriesOf, disputeEntries, liftDisputes, readDisputed } from './dictionary-dispute.js';
import { db } from '@tasnivo/db';
import { conflictingSibling } from './effective-code.js';
import { acceptCode } from './finding-kinds.js';
import { sureBandSql } from './sure-band.js';
import { filterConditions } from './workspace.js';
import type { WsFilter } from './workspace-filter.js';
import { mayWrite, type RoleCarrier } from './write-access.js';

/** email: a signed-in CurrentUser carries it; otherwise it is read when a decision records it. */
export type Actor = { userId: string; orgId: string; clientIds?: string[] | null; email?: string } & RoleCarrier;
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const DECISION_ACTIONS = ['finding.accepted', 'finding.rejected', 'finding.bulk_accepted', 'finding.bulk_rejected', 'finding.carried_over', 'finding.auto_accepted'] as const;
const HISTORY_ACTIONS = [...DECISION_ACTIONS, 'finding.undone'];

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Who decided a row and how, as the server has it now. */
export type DecisionState = {
  decision: 'pending' | 'accepted' | 'rejected';
  chosenMxik: string | null;
  /** Email of the decider; null for the system or a removed account. */
  decidedBy: string | null;
  decidedAt: string | null;
  decisionSource: string | null;
  decisionEventId: string | null;
};

export type DecideFailure =
  | { ok: false; code: 'forbidden' | 'not_found' | 'not_in_classifier' | 'no_code' | 'failed'; error: string }
  | ({ ok: false; code: 'already_decided'; error: string } & DecisionState)
  | { ok: false; code: 'sibling_conflict'; error: string; sibling: { findingId: string; type: string; chosenMxik: string } };

export type DecideOutcome = { ok: true; eventId: string } | DecideFailure;

class Abort extends Error {
  constructor(readonly outcome: DecideFailure) { super(outcome.error); }
}

const failure = (code: 'forbidden' | 'not_found' | 'not_in_classifier' | 'no_code' | 'failed'): DecideFailure => ({ ok: false, code, error: code });

/** The decision currently on a finding, with the decider's email (same org only). */
export async function decisionStateOf(orgId: string, findingId: string): Promise<DecisionState | null> {
  const f = await db.finding.findFirst({
    where: { id: findingId, item: { catalog: { orgId } } },
    select: { decision: true, chosenMxik: true, decidedBy: true, decidedAt: true, decisionSource: true, decisionEventId: true },
  });
  if (!f) return null;
  const who = f.decidedBy ? await db.user.findFirst({ where: { id: f.decidedBy, orgId }, select: { email: true } }) : null;
  return {
    decision: f.decision, chosenMxik: f.chosenMxik, decidedBy: who?.email ?? null, decidedAt: f.decidedAt?.toISOString() ?? null,
    decisionSource: f.decisionSource, decisionEventId: f.decisionEventId,
  };
}

async function alreadyDecided(orgId: string, findingId: string): Promise<DecideFailure> {
  const state = await decisionStateOf(orgId, findingId);
  if (!state || state.decision === 'pending') return failure('failed');
  return { ok: false, code: 'already_decided', error: 'already decided', ...state };
}

/**
 * One accept or reject by a person. Never overwrites a decision: a decided
 * row returns `already_decided` with who decided it. Accepting a code the
 * row's other finding contradicts returns `sibling_conflict`.
 */
export async function recordDecision(
  actor: Actor,
  input: { findingId: string; decision: 'accepted' | 'rejected'; chosenMxik?: string | null },
): Promise<DecideOutcome> {
  if (!mayWrite(actor)) return failure('forbidden');
  const finding = await db.finding.findFirst({
    where: { id: input.findingId, item: { catalog: catalogScope(actor) } },
    select: {
      id: true, suggestedMxik: true, type: true, decision: true, evidence: true,
      item: { select: { id: true, rawName: true, catalogId: true, unit: true, barcode: true, existingMxik: true } },
    },
  });
  if (!finding) return failure('not_found');
  if (finding.decision !== 'pending') return alreadyDecided(actor.orgId, finding.id);

  const rerankNone = readEvidence(finding.evidence)?.rerankNone === true;
  const chosen = input.decision === 'accepted'
    ? (input.chosenMxik ?? acceptCode({ type: finding.type, suggestedMxik: finding.suggestedMxik, existingMxik: finding.item.existingMxik, rerankNone }))
    : null;
  if (input.decision === 'accepted' && !chosen) return failure('no_code');
  if (chosen && !(await liveCodeSet([chosen])).has(chosen)) return failure('not_in_classifier');

  const learnable = chosen ? [{ rawName: finding.item.rawName, unit: finding.item.unit, barcode: finding.item.barcode, code: chosen }] : [];
  const learner = await learnerOf(actor.orgId, actor.userId, actor);
  // Rejecting what the dictionary suggested disputes the entry behind it.
  const disputes = input.decision === 'rejected' ? await dictionaryEntriesOf(actor.orgId, [finding]) : new Map<string, string>();
  try {
    const eventId = await db.$transaction(async (tx) => {
      // Decisions on one row queue up here, so two reviewers cannot give it two codes.
      await tx.$queryRaw`SELECT id FROM catalog_item WHERE id = ${finding.item.id} FOR UPDATE`;
      if (chosen) {
        const siblings = await tx.finding.findMany({
          where: { itemId: finding.item.id, id: { not: finding.id } },
          select: { id: true, type: true, decision: true, chosenMxik: true, decidedAt: true },
        });
        const clash = conflictingSibling(siblings, finding.id, chosen);
        if (clash?.chosenMxik) {
          throw new Abort({ ok: false, code: 'sibling_conflict', error: 'sibling conflict', sibling: { findingId: clash.id, type: clash.type, chosenMxik: clash.chosenMxik } });
        }
      }
      const dictionaryBefore = learnable.length > 0 ? await snapshotMappings(tx, actor.orgId, learnable) : [];
      const at = new Date();
      const disputed = await disputeEntries(tx, { orgId: actor.orgId, userId: actor.userId, at, via: 'rejected', catalogId: finding.item.catalogId, byFinding: disputes });
      // This record is the long-term asset: a product-name-to-verified-code
      // dataset, and what a client shows an inspector as due diligence.
      const event = await tx.auditEvent.create({
        data: {
          orgId: actor.orgId,
          actorId: actor.userId,
          action: `finding.${input.decision}`,
          targetId: finding.id,
          createdAt: at,
          payload: {
            catalogId: finding.item.catalogId,
            type: finding.type,
            source: 'manual',
            productName: finding.item.rawName,
            suggestedMxik: finding.suggestedMxik,
            chosenMxik: chosen,
            overrodeSuggestion: chosen !== null && chosen !== finding.suggestedMxik,
            // Kept so the decision still names a person after their account is removed.
            deciderEmail: learner.email,
            ...(learner.scoped ? { scoped: true } : {}),
            ...(dictionaryBefore.length > 0 ? { dictionaryBefore } : {}),
            ...(disputed.length > 0 ? { dictionaryDisputed: disputed } : {}),
          },
        },
      });
      const updated = await tx.finding.updateMany({
        where: { id: finding.id, decision: 'pending' },
        data: {
          decision: input.decision, chosenMxik: chosen, decidedBy: actor.userId,
          decidedAt: event.createdAt, decisionEventId: event.id, decisionSource: 'manual',
        },
      });
      // Someone else decided it in the meantime: roll the event back too.
      if (updated.count !== 1) throw new Abort(failure('failed'));
      return event.id;
    });
    // Accepting teaches the firm dictionary; a later row with the same product reuses it.
    // A scoped accountant's decision is kept unconfirmed until someone who sees every client confirms it.
    if (chosen) await learnQuietly(actor.orgId, actor.userId, learnable, 'manual', { scoped: learner.scoped });
    return { ok: true, eventId };
  } catch (error) {
    if (error instanceof Abort && error.outcome.code !== 'failed') return error.outcome;
    const state = await alreadyDecided(actor.orgId, finding.id);
    return state.code === 'already_decided' ? state : failure('failed');
  }
}

export type ManyResult = ({ ok: true } & ManyDone) | { ok: false; error: string };

/** One decision for a group of similar rows: one audit event, one undo, each row with its own suggestion. */
export async function recordGroupDecision(
  actor: Actor,
  input: { findingIds: string[]; decision: 'accepted' | 'rejected' },
): Promise<ManyResult> {
  if (!mayWrite(actor)) return fail('forbidden');
  const rows = await db.finding.findMany({
    where: { id: { in: input.findingIds }, decision: 'pending', item: { catalog: catalogScope(actor) } },
    select: { id: true, type: true, suggestedMxik: true, evidence: true, item: { select: { id: true, catalogId: true, rawName: true, unit: true, barcode: true, existingMxik: true } } },
  });
  const catalogId = rows[0]?.item.catalogId;
  if (!catalogId) return fail('nothing decided');
  const targets: ManyTarget[] = rows.filter((r) => r.item.catalogId === catalogId).map((r) => ({
    id: r.id, itemId: r.item.id, rawName: r.item.rawName, unit: r.item.unit, barcode: r.item.barcode,
    code: acceptCode({ type: r.type, suggestedMxik: r.suggestedMxik, existingMxik: r.item.existingMxik, rerankNone: readEvidence(r.evidence)?.rerankNone === true }),
  }));
  const inCatalog = rows.filter((r) => r.item.catalogId === catalogId);
  const disputes = input.decision === 'rejected' ? await dictionaryEntriesOf(actor.orgId, inCatalog) : undefined;
  const done = await decideMany({
    orgId: actor.orgId, userId: actor.userId, catalogId, decision: input.decision, source: 'group', payload: { mode: 'group' },
    learner: await learnerOf(actor.orgId, actor.userId, actor), ...(disputes ? { disputes } : {}),
  }, targets);
  return { ok: true, ...done };
}

/** Takes one row out of its group, so it is reviewed on its own. */
export async function splitFromGroup(actor: Actor, findingId: string): Promise<Result> {
  if (!mayWrite(actor)) return fail('forbidden');
  const finding = await db.finding.findFirst({
    where: { id: findingId, item: { catalog: catalogScope(actor) } },
    select: { id: true, item: { select: { catalogId: true, rawName: true } } },
  });
  if (!finding) return fail('not found');
  await db.$transaction([
    db.finding.update({ where: { id: finding.id }, data: { groupSplit: true }, select: { id: true } }),
    db.auditEvent.create({
      data: {
        orgId: actor.orgId, actorId: actor.userId, action: 'finding.split_from_group', targetId: finding.id,
        payload: { catalogId: finding.item.catalogId, productName: finding.item.rawName },
      },
    }),
  ]);
  return { ok: true };
}

/** The high-match set of a catalogue, optionally narrowed to a workspace filter. */
async function sureTargets(catalogId: string, minConfidence: number, filter: WsFilter | null): Promise<(ManyTarget & { type: string })[]> {
  const where = filter ? filterConditions(catalogId, filter) : [Prisma.sql`ci."catalogId" = ${catalogId}`];
  const rows = await db.$queryRaw<{ id: string; type: string; itemId: string; code: string; rawName: string; unit: string | null; barcode: string | null }[]>(Prisma.sql`
    SELECT f.id, f.type::text AS type, ci.id AS "itemId", f."suggestedMxik" AS code, ci."rawName", ci.unit, ci.barcode
    FROM finding f JOIN catalog_item ci ON ci.id = f."itemId"
    WHERE ${Prisma.join(where, ' AND ')} AND ${sureBandSql(minConfidence)}`);
  return rows;
}

export type SurePreview = { total: number; byType: Record<string, number>; skipped: Skipped; willAccept: number };

/** What "accept all high-match" would do, without doing it. */
export async function sureBandPreview(actor: Actor, catalogId: string, filter: WsFilter | null): Promise<Result<SurePreview>> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, ...catalogScope(actor) }, select: { id: true } });
  if (!catalog) return fail('not found');
  const targets = await sureTargets(catalog.id, BANDS.high, filter);
  const { ready, skipped } = await screenTargets('accepted', targets);
  const byType: Record<string, number> = {};
  for (const t of targets) byType[t.type] = (byType[t.type] ?? 0) + 1;
  return { ok: true, total: targets.length, byType, skipped, willAccept: ready.length };
}

/** "Accept all high-match suggestions": the high band only, live codes only, one undoable event. */
export async function bulkAccept(
  actor: Actor,
  input: { catalogId: string; minConfidence: number; filter?: WsFilter | null },
): Promise<ManyResult> {
  if (!mayWrite(actor)) return fail('forbidden');
  if (input.minConfidence < BANDS.high) return fail('threshold below the high band');
  const catalog = await db.catalog.findFirst({ where: { id: input.catalogId, ...catalogScope(actor) }, select: { id: true } });
  if (!catalog) return fail('not found');
  const targets = await sureTargets(catalog.id, input.minConfidence, input.filter ?? null);
  const done = await decideMany({
    orgId: actor.orgId, userId: actor.userId, catalogId: catalog.id, decision: 'accepted', source: 'bulk_sure',
    payload: { minConfidence: input.minConfidence, scope: input.filter ? 'filter' : 'catalogue' },
    learner: await learnerOf(actor.orgId, actor.userId, actor),
  }, targets);
  return { ok: true, ...done };
}

/** Dictionary entries this undo should take back: those learned by the reverted rows and not restored by an earlier partial undo. */
async function dictionaryToRestore(
  eventId: string, payload: Record<string, unknown>, reverted: { rawName: string; unit: string | null; barcode: string | null; code: string | null }[], remaining: { rawName: string; unit: string | null; barcode: string | null; code: string | null }[],
) {
  const before = readMappingsBefore(payload['dictionaryBefore']);
  if (before.length === 0) return [];
  const asLearnable = (rows: typeof reverted) => rows.flatMap((r) => (r.code ? [{ rawName: r.rawName, unit: r.unit, barcode: r.barcode, code: r.code }] : []));
  const mine = new Set(learnKeys(asLearnable(reverted)));
  const kept = new Set(learnKeys(asLearnable(remaining)));
  const earlier = await db.auditEvent.findMany({ where: { action: 'finding.undone', targetId: eventId }, select: { payload: true } });
  const done = new Set(earlier.flatMap((e) => {
    const p = (typeof e.payload === 'object' && e.payload !== null ? e.payload : {}) as Record<string, unknown>;
    return Array.isArray(p['dictionaryRestored']) ? p['dictionaryRestored'].filter((k): k is string => typeof k === 'string') : [];
  }));
  return before.filter((b) => {
    const key = `${b.kind}:${b.key}`;
    return mine.has(key) && !kept.has(key) && !done.has(key);
  });
}

const sourceOf = (payload: Record<string, unknown>, action: string): LearnSource =>
  payload['source'] === 'group' ? 'group' : payload['source'] === 'bulk_sure' ? 'bulk_sure' : action === 'finding.accepted' ? 'manual' : 'bulk';

export type UndoDone = { findingIds: string[]; row: { findingId: string; productName: string; rowIndex: number } | null };

/**
 * Reverts the findings an earlier decision event set, back to pending, and
 * appends a `finding.undone` event. Only findings still carrying that event's
 * decision are touched, so undoing twice is a no-op error, not a corruption.
 * What the decision taught the firm dictionary is taken back too.
 * `onlyFindingId` narrows a bulk event to one row.
 */
export async function undoDecision(actor: Actor, eventId: string, onlyFindingId?: string): Promise<Result<UndoDone>> {
  if (!mayWrite(actor)) return fail('forbidden');
  const event = await db.auditEvent.findFirst({
    where: { id: eventId, orgId: actor.orgId, action: { in: [...DECISION_ACTIONS] } },
    select: { id: true, action: true, payload: true, createdAt: true, actorId: true },
  });
  if (!event) return fail('not found');
  const payload = (typeof event.payload === 'object' && event.payload !== null ? event.payload : {}) as Record<string, unknown>;

  const carrying = await db.finding.findMany({
    where: { decisionEventId: event.id, item: { catalog: catalogScope(actor) } },
    select: { id: true, decision: true, chosenMxik: true, item: { select: { rawName: true, catalogId: true, rowIndex: true, unit: true, barcode: true } } },
  });
  const findings = onlyFindingId ? carrying.filter((f) => f.id === onlyFindingId) : carrying;
  if (findings.length === 0) return fail('already undone');
  const remaining = carrying.filter((f) => !findings.includes(f));

  const shape = (f: (typeof carrying)[number]) => ({ rawName: f.item.rawName, unit: f.item.unit, barcode: f.item.barcode, code: f.chosenMxik });
  const restore = await dictionaryToRestore(event.id, payload, findings.map(shape), remaining.map(shape));
  const ids = findings.map((f) => f.id);
  try {
    await db.$transaction(async (tx) => {
      const reverted = await tx.finding.updateMany({
        where: { id: { in: ids }, decisionEventId: event.id },
        data: { decision: 'pending', chosenMxik: null, decidedBy: null, decidedAt: null, decisionEventId: null, decisionSource: null },
      });
      if (reverted.count === 0) throw new Error('already undone');
      // A scoped member's decision taught no confirmation, so none is taken back.
      const confirmed = confirms(sourceOf(payload, event.action)) && payload['scoped'] !== true;
      const restored = restore.length > 0 ? await restoreMappings(tx, actor.orgId, restore, confirmed) : 0;
      // A partial undo of a group reject keeps the disputes: the other rows still say the entry was wrong.
      const lifted = remaining.length === 0 ? await liftDisputes(tx, actor.orgId, readDisputed(payload), event.createdAt, event.actorId) : 0;
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
            ...(restore.length > 0 ? { dictionaryRestored: restore.map((b) => `${b.kind}:${b.key}`), dictionaryChanged: restored } : {}),
            ...(lifted > 0 ? { dictionaryUndisputed: lifted } : {}),
          },
        },
      });
    }, { timeout: 120_000 });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'failed');
  }
  const first = findings[0];
  return { ok: true, findingIds: ids, row: first ? { findingId: first.id, productName: first.item.rawName, rowIndex: first.item.rowIndex } : null };
}

/**
 * Takes one row's decision back so it can be decided again ("change
 * decision"). A decision with its event is undone through it, which also
 * takes back what it taught the dictionary; an older decision recorded
 * without an event is reopened with a `finding.undone` event of its own that
 * keeps what it was.
 */
export async function reopenDecision(actor: Actor, findingId: string): Promise<Result<UndoDone>> {
  if (!mayWrite(actor)) return fail('forbidden');
  const f = await db.finding.findFirst({
    where: { id: findingId, item: { catalog: catalogScope(actor) } },
    select: {
      id: true, decision: true, chosenMxik: true, decisionEventId: true, decisionSource: true, decidedBy: true, decidedAt: true,
      item: { select: { rawName: true, catalogId: true, rowIndex: true } },
    },
  });
  if (!f) return fail('not found');
  if (f.decision === 'pending') return fail('already undone');
  if (f.decisionEventId) return undoDecision(actor, f.decisionEventId, f.id);
  try {
    await db.$transaction(async (tx) => {
      const reopened = await tx.finding.updateMany({
        where: { id: f.id, decision: { not: 'pending' }, decisionEventId: null },
        data: { decision: 'pending', chosenMxik: null, decidedBy: null, decidedAt: null, decisionSource: null },
      });
      if (reopened.count === 0) throw new Error('already undone');
      await tx.auditEvent.create({
        data: {
          orgId: actor.orgId, actorId: actor.userId, action: 'finding.undone', targetId: f.id,
          payload: {
            catalogId: f.item.catalogId, undoneEventId: null, undoneAction: null, reopened: true,
            findings: [{
              id: f.id, productName: f.item.rawName, previousDecision: f.decision, previousChosenMxik: f.chosenMxik,
              previousSource: f.decisionSource, previousDecidedBy: f.decidedBy, previousDecidedAt: f.decidedAt?.toISOString() ?? null,
            }],
          },
        },
      });
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'failed');
  }
  return { ok: true, findingIds: [f.id], row: { findingId: f.id, productName: f.item.rawName, rowIndex: f.item.rowIndex } };
}

/**
 * Undoes the actor's own latest manual decision in this catalogue that is
 * still in effect: a single accept or reject, or a group decision. Other
 * people's decisions and bulk actions are undone from their own controls.
 */
export async function undoLast(actor: Actor, catalogId: string): Promise<Result<UndoDone>> {
  if (!mayWrite(actor)) return fail('forbidden');
  const recent = await db.auditEvent.findMany({
    where: {
      orgId: actor.orgId,
      actorId: actor.userId,
      AND: [
        { payload: { path: ['catalogId'], equals: catalogId } },
        {
          OR: [
            { action: { in: ['finding.accepted', 'finding.rejected'] } },
            { action: { in: ['finding.bulk_accepted', 'finding.bulk_rejected'] }, payload: { path: ['source'], equals: 'group' } },
          ],
        },
      ],
    },
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

/** Decision events of one catalogue the actor may see; nothing for a catalogue outside their clients. */
export async function decisionHistory(actor: Actor, catalogId: string, limit = 50): Promise<HistoryEntry[]> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, ...catalogScope(actor) }, select: { id: true } });
  if (!catalog) return [];
  const events = await db.auditEvent.findMany({
    where: { orgId: actor.orgId, action: { in: HISTORY_ACTIONS }, payload: { path: ['catalogId'], equals: catalog.id } },
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
