'use server';

import { getI18n } from '@/lib/locale';
import { z } from 'zod';
import { currentUser } from '@/lib/session';
import { writer } from '@/lib/guard';
import { searchClassifier } from '@/lib/audit-runner';
import { codeRequestText } from '@/lib/code-request';
import { BANDS } from '@/core/match/score';
import { bulkAccept, recordDecision, recordGroupDecision, splitFromGroup, undoDecision, undoLast } from '@/lib/decisions';

const DecideInput = z.object({
  findingId: z.string().min(1),
  decision: z.enum(['accepted', 'rejected']),
  /** Present when the reviewer picked a code other than the suggestion. */
  chosenMxik: z.string().regex(/^\d{17}$/).nullable().optional(),
});

export type DecideResult = { ok: true; eventId: string } | { ok: false; error: string };

/** Records one accept/reject and its audit event. Never overwrites a decision. */
export async function decide(payload: unknown): Promise<DecideResult> {
  const { t } = await getI18n();
  const user = await writer();
  if (!user) return { ok: false, error: t.errorGeneric };
  const parsed = DecideInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: t.errorGeneric };

  const result = await recordDecision(user, parsed.data);
  if (!result.ok) return { ok: false, error: t.errorGeneric };
  return result;
}

const GroupInput = z.object({
  findingIds: z.array(z.string().min(1)).min(1).max(5000),
  decision: z.enum(['accepted', 'rejected']),
});

export type GroupResult = { ok: true; decided: { findingId: string; eventId: string }[] } | { ok: false; error: string };

/** One accept/reject for a group of similar rows; one audit event per row. */
export async function decideGroup(payload: unknown): Promise<GroupResult> {
  const { t } = await getI18n();
  const user = await writer();
  if (!user) return { ok: false, error: t.errorGeneric };
  const parsed = GroupInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: t.errorGeneric };

  const result = await recordGroupDecision(user, parsed.data);
  if (!result.ok) return { ok: false, error: t.errorGeneric };
  return result;
}

/** Takes a row out of its group so it can be decided on its own. */
export async function splitRow(findingId: unknown): Promise<{ ok: boolean }> {
  const user = await writer();
  if (!user) return { ok: false };
  const id = z.string().min(1).safeParse(findingId);
  if (!id.success) return { ok: false };
  const result = await splitFromGroup(user, id.data);
  return { ok: result.ok };
}

const BulkInput = z.object({
  catalogId: z.string().min(1),
  // Enforced here, not trusted from the browser: bulk accept is only ever for
  // the high band, which retrieval alone cannot reach.
  minConfidence: z.number().min(BANDS.high).max(1),
});

export type BulkResult = { ok: true; count: number } | { ok: false; error: string };

/** "Accept all above 90%." Only touches pending findings that have a suggestion. */
export async function acceptAllAbove(payload: unknown): Promise<BulkResult> {
  const { t } = await getI18n();
  const user = await writer();
  if (!user) return { ok: false, error: t.errorGeneric };
  const parsed = BulkInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: t.errorGeneric };

  const result = await bulkAccept(user, parsed.data);
  if (!result.ok) return { ok: false, error: t.errorGeneric };
  return { ok: true, count: result.count };
}

export type UndoResult = { ok: true; findingIds: string[] } | { ok: false; error: string };

const UndoInput = z.union([
  z.object({ eventId: z.string().min(1), findingId: z.string().min(1).optional() }),
  z.object({ lastInCatalog: z.string().min(1) }),
]);

/** Undo a decision event (or one row of it), or the latest one still in effect for a catalogue. */
export async function undo(payload: unknown): Promise<UndoResult> {
  const { t } = await getI18n();
  const user = await writer();
  if (!user) return { ok: false, error: t.errorGeneric };
  const parsed = UndoInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: t.errorGeneric };

  const result = 'eventId' in parsed.data
    ? await undoDecision(user, parsed.data.eventId, parsed.data.findingId)
    : await undoLast(user, parsed.data.lastInCatalog);
  if (!result.ok) return { ok: false, error: t.reviewUndoFailed };
  return result;
}

/** Draft text for a new-code request on tasnif.soliq.uz. Never submitted from here. */
export async function newCodeRequest(findingId: unknown): Promise<string | null> {
  const user = await writer();
  const id = z.string().min(1).safeParse(findingId);
  if (!user || !id.success) return null;
  return codeRequestText(user.orgId, id.data);
}

export type ClassifierHit = {
  code: string;
  name: string;
  path: string;
  isBase: boolean;
  unit: string | null;
};

/** Backs the "pick another code" search box on the Review screen. */
export async function lookupCodes(query: string): Promise<ClassifierHit[]> {
  const user = await currentUser();
  if (!user) return [];
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const hits = await searchClassifier(trimmed, 10);
  return hits.map((c) => ({
    code: c.code,
    name: c.nameUz,
    path: [c.groupName, c.className, c.positionName, c.subPositionName]
      .filter((s): s is string => Boolean(s)).join(' → '),
    isBase: c.isBase,
    unit: c.unitBinding === 'strict' && c.unitCanonical.length > 0
      ? c.unitCanonical.join(' / ')
      : null,
  }));
}
