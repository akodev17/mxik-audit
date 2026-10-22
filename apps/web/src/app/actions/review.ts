'use server';

import { getI18n } from '@/lib/locale';
import { z } from 'zod';
import { currentUser } from '@/lib/session';
import { writer } from '@/lib/guard';
import { searchClassifier } from '@tasnivo/domain/audit-runner';
import { lookupCodes as lookupClassifier, type ClassifierHit } from '@tasnivo/domain/code-lookup';
import { codeRequestText } from '@tasnivo/domain/code-request';
import { BANDS } from '@tasnivo/core/match/score';
import {
  acceptSure, decideFinding, decideGroup as decideGroupOf, previewSure as previewSureOf, splitRow as splitRowOf, undoReview,
  type DecideResult, type ManyOutcome, type SurePreviewResult, type UndoResult,
} from '@tasnivo/domain/workspace-ops';
import { FilterInput } from '@tasnivo/domain/workspace-filter';

export type { ClassifierHit, DecideResult, ManyOutcome, SurePreviewResult, UndoResult };

const DecideInput = z.object({
  findingId: z.string().min(1),
  decision: z.enum(['accepted', 'rejected']),
  /** Present when the reviewer picked a code other than the suggestion. */
  chosenMxik: z.string().regex(/^\d{17}$/).nullable().optional(),
});

/** Records one accept/reject and its audit event. Never overwrites a decision; conflicts come back typed. */
export async function decide(payload: unknown): Promise<DecideResult> {
  const { t, locale } = await getI18n();
  const user = await writer();
  if (!user) return { ok: false, code: 'forbidden', error: t.errorGeneric };
  const parsed = DecideInput.safeParse(payload);
  if (!parsed.success) return { ok: false, code: 'failed', error: t.errorGeneric };
  return decideFinding(user, parsed.data, locale);
}

const GroupInput = z.object({
  findingIds: z.array(z.string().min(1)).min(1).max(5000),
  decision: z.enum(['accepted', 'rejected']),
});

/** One accept/reject for a group of similar rows: one audit event, one undo. */
export async function decideGroup(payload: unknown): Promise<ManyOutcome> {
  const { t, locale } = await getI18n();
  const user = await writer();
  const parsed = GroupInput.safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  return decideGroupOf(user, parsed.data, locale);
}

/** Takes a row out of its group so it can be decided on its own. */
export async function splitRow(findingId: unknown): Promise<{ ok: boolean }> {
  const user = await writer();
  const id = z.string().min(1).safeParse(findingId);
  if (!user || !id.success) return { ok: false };
  return splitRowOf(user, id.data);
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
  const { t, locale } = await getI18n();
  const user = await writer();
  const parsed = SureInput.safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  return acceptSure(user, parsed.data, locale);
}

/** Counts for the confirmation before "accept all high-match": by type, and what would be skipped. */
export async function previewSure(payload: unknown): Promise<SurePreviewResult> {
  const { t, locale } = await getI18n();
  const user = await writer();
  const parsed = SureInput.omit({ minConfidence: true }).safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  return previewSureOf(user, parsed.data.catalogId, parsed.data.filter, locale);
}

const UndoInput = z.union([
  z.object({ eventId: z.string().min(1), findingId: z.string().min(1).optional() }),
  z.object({ lastInCatalog: z.string().min(1) }),
  z.object({ reopen: z.string().min(1) }),
]);

/** Undo a decision event (or one row of it), the caller's own latest manual decision in a catalogue, or reopen one decided row. */
export async function undo(payload: unknown): Promise<UndoResult> {
  const { t, locale } = await getI18n();
  const user = await writer();
  const parsed = UndoInput.safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  return undoReview(user, parsed.data, locale);
}

/** Draft text for a new-code request on tasnif.soliq.uz. Never submitted from here; read-only for viewers. */
export async function newCodeRequest(findingId: unknown): Promise<string | null> {
  const user = await currentUser();
  const id = z.string().min(1).safeParse(findingId);
  if (!user || !id.success) return null;
  return codeRequestText(user, id.data);
}

/** Backs the "pick another code" search; names and paths in the viewer's language. */
export async function lookupCodes(query: string): Promise<ClassifierHit[]> {
  const user = await currentUser();
  if (!user) return [];
  const { locale } = await getI18n();
  return lookupClassifier(query, locale, searchClassifier);
}
