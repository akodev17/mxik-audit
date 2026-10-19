// One decision for many findings (group, bulk, high-match): one audit event,
// one undo. Archived codes and rows that already hold another code are
// skipped and reported, never silently accepted. The event records the ids the
// UPDATE actually changed (RETURNING) and the dictionary entries as they were
// before learning, so undo can take both back.
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from './db.js';
import { learnQuietly, snapshotMappings, type Learnable } from './dictionary.js';
import { batchConflicts } from './effective-code.js';

export type ManyTarget = { id: string; itemId: string; code: string | null; rawName: string; unit: string | null; barcode: string | null };
export type Skipped = { archived: number; conflict: number; noCode: number };
export type ManyDone = { count: number; eventId: string | null; ids: string[]; skipped: Skipped };

export type ManyOptions = {
  orgId: string;
  userId: string;
  catalogId: string;
  decision: 'accepted' | 'rejected';
  /** dictionary: the reviewer accepted the firm dictionary's matches; that teaches the dictionary nothing new. */
  source: 'bulk' | 'bulk_sure' | 'group' | 'dictionary';
  /** Extra audit payload (mode, filter, threshold). */
  payload?: Record<string, Prisma.InputJsonValue>;
};

/** Codes from the list that are live in the classifier now. */
export async function liveCodeSet(codes: Iterable<string>): Promise<Set<string>> {
  const list = [...new Set(codes)];
  if (list.length === 0) return new Set();
  const rows = await db.$queryRaw<{ code: string }[]>`SELECT code FROM mxik_code WHERE code = ANY(${list}) AND "retiredAt" IS NULL`;
  return new Set(rows.map((r) => r.code.trim()));
}

/** Codes already accepted on each of these rows. */
async function acceptedByItem(itemIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (itemIds.length === 0) return out;
  const rows = await db.finding.findMany({
    where: { itemId: { in: [...new Set(itemIds)] }, decision: 'accepted', chosenMxik: { not: null } },
    select: { itemId: true, chosenMxik: true },
  });
  for (const r of rows) if (r.chosenMxik) out.set(r.itemId, [...(out.get(r.itemId) ?? []), r.chosenMxik]);
  return out;
}

/** Splits targets into those that may be decided and the counts of each reason to skip. */
export async function screenTargets(decision: 'accepted' | 'rejected', targets: readonly ManyTarget[]): Promise<{ ready: ManyTarget[]; skipped: Skipped }> {
  const skipped: Skipped = { archived: 0, conflict: 0, noCode: 0 };
  if (decision === 'rejected') return { ready: [...targets], skipped };
  const withCode = targets.filter((t): t is ManyTarget & { code: string } => t.code !== null);
  skipped.noCode = targets.length - withCode.length;
  const live = await liveCodeSet(withCode.map((t) => t.code));
  const alive = withCode.filter((t) => live.has(t.code));
  skipped.archived = withCode.length - alive.length;
  const bad = batchConflicts(alive, await acceptedByItem(alive.map((t) => t.itemId)));
  skipped.conflict = bad.size;
  return { ready: alive.filter((t) => !bad.has(t.id)), skipped };
}

const learnable = (rows: readonly ManyTarget[]): Learnable[] =>
  rows.flatMap((r) => (r.code ? [{ rawName: r.rawName, unit: r.unit, barcode: r.barcode, code: r.code }] : []));

export async function decideMany(o: ManyOptions, targets: readonly ManyTarget[]): Promise<ManyDone> {
  const { ready, skipped } = await screenTargets(o.decision, targets);
  if (ready.length === 0) return { count: 0, eventId: null, ids: [], skipped };

  const eventId = randomUUID();
  const now = new Date();
  const accept = o.decision === 'accepted';
  const teaches = accept && o.source !== 'dictionary';
  const ids = ready.map((t) => t.id);
  const done = await db.$transaction(async (tx) => {
    // The sibling check repeats inside the statement, so a decision made meanwhile is respected.
    const updated = accept
      ? await tx.$queryRaw<{ id: string }[]>`
          UPDATE finding f SET decision = 'accepted'::decision, "chosenMxik" = t.code, "decidedBy" = ${o.userId}, "decidedAt" = ${now},
            "decisionEventId" = ${eventId}, "decisionSource" = ${o.source}
          FROM unnest(${ids}::text[], ${ready.map((t) => t.code)}::text[]) AS t(id, code)
          WHERE f.id = t.id AND f.decision = 'pending'::decision
            AND NOT EXISTS (SELECT 1 FROM finding s WHERE s."itemId" = f."itemId" AND s.id <> f.id
              AND s.decision = 'accepted'::decision AND s."chosenMxik" IS NOT NULL AND s."chosenMxik" <> t.code)
          RETURNING f.id`
      : await tx.$queryRaw<{ id: string }[]>`
          UPDATE finding f SET decision = 'rejected'::decision, "chosenMxik" = NULL, "decidedBy" = ${o.userId}, "decidedAt" = ${now},
            "decisionEventId" = ${eventId}, "decisionSource" = ${o.source}
          WHERE f.id = ANY(${ids}) AND f.decision = 'pending'::decision
          RETURNING f.id`;
    if (updated.length === 0) return null;
    const touched = new Set(updated.map((r) => r.id));
    const rows = ready.filter((t) => touched.has(t.id));
    const dictionaryBefore = teaches ? await snapshotMappings(tx, o.orgId, learnable(rows)) : [];
    await tx.auditEvent.create({
      data: {
        id: eventId, orgId: o.orgId, actorId: o.userId, createdAt: now,
        action: accept ? 'finding.bulk_accepted' : 'finding.bulk_rejected',
        targetId: o.catalogId,
        payload: {
          catalogId: o.catalogId, source: o.source, count: rows.length, ...o.payload,
          skipped: { ...skipped, raced: ready.length - rows.length },
          findings: rows.map((r) => ({ id: r.id, productName: r.rawName, chosenMxik: accept ? r.code : null })),
          ...(dictionaryBefore.length > 0 ? { dictionaryBefore } : {}),
        },
      },
    });
    return rows;
  }, { timeout: 120_000 });

  if (!done) return { count: 0, eventId: null, ids: [], skipped };
  if (teaches) await learnQuietly(o.orgId, o.userId, learnable(done), o.source);
  return { count: done.length, eventId, ids: done.map((r) => r.id), skipped };
}
