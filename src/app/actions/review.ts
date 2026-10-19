'use server';

import { getI18n } from '@/lib/locale';
import { z } from 'zod';
import { currentUser } from '@/lib/session';
import { writer } from '@/lib/guard';
import { searchClassifier } from '@/lib/audit-runner';
import { codeDetails } from '@/lib/code-details';
import { codeRequestText } from '@/lib/code-request';
import { BANDS } from '@/core/match/score';
import type { Skipped } from '@/lib/decide-many';
import {
  bulkAccept, recordDecision, recordGroupDecision, splitFromGroup, sureBandPreview, undoDecision, undoLast,
  type DecideFailure, type SurePreview, type UndoDone,
} from '@/lib/decisions';
import { FilterInput, readFilter } from '@/lib/workspace-filter';

const DecideInput = z.object({
  findingId: z.string().min(1),
  decision: z.enum(['accepted', 'rejected']),
  /** Present when the reviewer picked a code other than the suggestion. */
  chosenMxik: z.string().regex(/^\d{17}$/).nullable().optional(),
});

export type DecideResult = { ok: true; eventId: string } | DecideFailure;

/** Records one accept/reject and its audit event. Never overwrites a decision; conflicts come back typed. */
export async function decide(payload: unknown): Promise<DecideResult> {
  const { t } = await getI18n();
  const user = await writer();
  if (!user) return { ok: false, code: 'forbidden', error: t.errorGeneric };
  const parsed = DecideInput.safeParse(payload);
  if (!parsed.success) return { ok: false, code: 'failed', error: t.errorGeneric };
  const result = await recordDecision(user, parsed.data);
  return result.ok ? result : { ...result, error: t.errorGeneric };
}

export type ManyOutcome = { ok: true; count: number; eventId: string | null; ids: string[]; skipped: Skipped } | { ok: false; error: string };

const GroupInput = z.object({
  findingIds: z.array(z.string().min(1)).min(1).max(5000),
  decision: z.enum(['accepted', 'rejected']),
});

/** One accept/reject for a group of similar rows: one audit event, one undo. */
export async function decideGroup(payload: unknown): Promise<ManyOutcome> {
  const { t } = await getI18n();
  const user = await writer();
  const parsed = GroupInput.safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  const result = await recordGroupDecision(user, parsed.data);
  return result.ok ? result : { ok: false, error: t.errorGeneric };
}

/** Takes a row out of its group so it can be decided on its own. */
export async function splitRow(findingId: unknown): Promise<{ ok: boolean }> {
  const user = await writer();
  const id = z.string().min(1).safeParse(findingId);
  if (!user || !id.success) return { ok: false };
  const result = await splitFromGroup(user, id.data);
  return { ok: result.ok };
}

const SureInput = z.object({
  catalogId: z.string().min(1),
  // Enforced here, not trusted from the browser: bulk accept is only ever for
  // the high band, which retrieval alone cannot reach.
  minConfidence: z.number().min(BANDS.high).max(1),
  /** The current workspace filter, or null for the whole catalogue. */
  filter: FilterInput.nullable().optional(),
});

/** "Accept all high-match suggestions" in the catalogue or the current filter. */
export async function acceptAllAbove(payload: unknown): Promise<ManyOutcome> {
  const { t } = await getI18n();
  const user = await writer();
  const parsed = SureInput.safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  const { catalogId, minConfidence, filter } = parsed.data;
  const result = await bulkAccept(user, { catalogId, minConfidence, filter: filter ? readFilter(filter) : null });
  return result.ok ? result : { ok: false, error: t.errorGeneric };
}

export type SurePreviewResult = ({ ok: true } & SurePreview) | { ok: false; error: string };

/** Counts for the confirmation before "accept all high-match": by type, and what would be skipped. */
export async function previewSure(payload: unknown): Promise<SurePreviewResult> {
  const { t } = await getI18n();
  const user = await writer();
  const parsed = SureInput.omit({ minConfidence: true }).safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  const result = await sureBandPreview(user, parsed.data.catalogId, parsed.data.filter ? readFilter(parsed.data.filter) : null);
  return result.ok ? result : { ok: false, error: t.errorGeneric };
}

export type UndoResult = ({ ok: true } & UndoDone) | { ok: false; error: string };

const UndoInput = z.union([
  z.object({ eventId: z.string().min(1), findingId: z.string().min(1).optional() }),
  z.object({ lastInCatalog: z.string().min(1) }),
]);

/** Undo a decision event (or one row of it), or the caller's own latest manual decision in a catalogue. */
export async function undo(payload: unknown): Promise<UndoResult> {
  const { t, ta } = await getI18n();
  const user = await writer();
  const parsed = UndoInput.safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };

  const result = 'eventId' in parsed.data
    ? await undoDecision(user, parsed.data.eventId, parsed.data.findingId)
    : await undoLast(user, parsed.data.lastInCatalog);
  if (result.ok) return result;
  return { ok: false, error: result.error === 'nothing to undo' ? ta.wsX.undo.nothing : t.reviewUndoFailed };
}

/** Draft text for a new-code request on tasnif.soliq.uz. Never submitted from here; read-only for viewers. */
export async function newCodeRequest(findingId: unknown): Promise<string | null> {
  const user = await currentUser();
  const id = z.string().min(1).safeParse(findingId);
  if (!user || !id.success) return null;
  return codeRequestText(user, id.data);
}

export type ClassifierHit = {
  code: string;
  name: string;
  path: string;
  isBase: boolean;
  unit: string | null;
};

/** Backs the "pick another code" search; names and paths in the viewer's language. */
export async function lookupCodes(query: string): Promise<ClassifierHit[]> {
  const user = await currentUser();
  if (!user || typeof query !== 'string') return [];
  const trimmed = query.trim().slice(0, 100);
  if (trimmed.length < 2) return [];
  const { locale } = await getI18n();
  const hits = await searchClassifier(trimmed, 10);
  const details = await codeDetails(hits.map((c) => c.code), locale);
  return hits.map((c) => {
    const d = details.get(c.code);
    return {
      code: c.code,
      name: d?.name ?? c.nameUz,
      path: d?.fullPath ?? [c.groupName, c.className, c.positionName, c.subPositionName].filter((s): s is string => Boolean(s)).join(' → '),
      isBase: c.isBase,
      unit: c.unitBinding === 'strict' && c.unitCanonical.length > 0 ? c.unitCanonical.join(' / ') : null,
    };
  });
}
