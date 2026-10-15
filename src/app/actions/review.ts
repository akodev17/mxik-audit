'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { searchClassifier } from '@/lib/audit-runner';
import { BANDS } from '@/core/match/score';
import { bulkAccept, recordDecision, undoDecision, undoLast } from '@/lib/decisions';

const DecideInput = z.object({
  findingId: z.string().min(1),
  decision: z.enum(['accepted', 'rejected']),
  /** Present when the reviewer picked a code other than the suggestion. */
  chosenMxik: z.string().regex(/^\d{17}$/).nullable().optional(),
});

export type DecideResult = { ok: true; eventId: string } | { ok: false; error: string };

function refresh(): void {
  revalidatePath('/review');
  revalidatePath('/report');
  revalidatePath('/export');
}

/** Records one accept/reject and its audit event. Never overwrites a decision. */
export async function decide(payload: unknown): Promise<DecideResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: t.errorGeneric };
  const parsed = DecideInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: t.errorGeneric };

  const result = await recordDecision(user, parsed.data);
  if (!result.ok) return { ok: false, error: t.errorGeneric };
  refresh();
  return result;
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
  const user = await currentUser();
  if (!user) return { ok: false, error: t.errorGeneric };
  const parsed = BulkInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: t.errorGeneric };

  const result = await bulkAccept(user, parsed.data);
  if (!result.ok) return { ok: false, error: t.errorGeneric };
  refresh();
  return { ok: true, count: result.count };
}

export type UndoResult = { ok: true; findingIds: string[] } | { ok: false; error: string };

const UndoInput = z.union([
  z.object({ eventId: z.string().min(1), findingId: z.string().min(1).optional() }),
  z.object({ lastInCatalog: z.string().min(1) }),
]);

/** Undo a decision event (or one row of it), or the latest one still in effect for a catalogue. */
export async function undo(payload: unknown): Promise<UndoResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: t.errorGeneric };
  const parsed = UndoInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: t.errorGeneric };

  const result = 'eventId' in parsed.data
    ? await undoDecision(user, parsed.data.eventId, parsed.data.findingId)
    : await undoLast(user, parsed.data.lastInCatalog);
  if (!result.ok) return { ok: false, error: t.reviewUndoFailed };
  refresh();
  return result;
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
