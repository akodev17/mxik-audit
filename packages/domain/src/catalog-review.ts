// Assigning and finishing a catalogue's review task, with the refusals the user reads. Shared by
// the web's reviews actions and the API's catalogs module; `user` is null when the writer guard
// did not pass.
import { z } from 'zod';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { canWrite } from './access.js';
import { isDemoOrg } from './demo.js';
import { assignReview, completeReview, NOTE_MAX } from './review-assignments.js';
import type { CurrentUser } from './session.js';

export type ReviewActionResult = { ok: true; changed?: boolean } | { ok: false; error: string };

const Assign = z.object({
  catalogId: z.string().min(1).max(64),
  assigneeId: z.string().min(1).max(64),
  dueOn: z.string().max(10).nullable(),
  note: z.string().max(NOTE_MAX * 4).nullable(),
});
const Complete = z.object({ catalogId: z.string().min(1).max(64), note: z.string().max(NOTE_MAX * 4).nullable() });

/** Hands a ready catalogue to a team member; refused for viewers, in a demo, and for anything outside the user's scope. */
export async function assignCatalogReview(user: CurrentUser | null, locale: Locale, payload: unknown): Promise<ReviewActionResult> {
  const e = i18nFor(locale).ta.review.errors;
  if (!user || !canWrite(user) || await isDemoOrg(user.orgId)) return { ok: false, error: e.forbidden };
  const parsed = Assign.safeParse(payload);
  if (!parsed.success) return { ok: false, error: e['bad note'] };
  const result = await assignReview(user, parsed.data);
  if (!result.ok) return { ok: false, error: e[result.error] };
  return { ok: true, changed: result.changed };
}

/** Marks a review done: by its assignee or an admin, never twice, never in a demo. */
export async function finishCatalogReview(user: CurrentUser | null, locale: Locale, payload: unknown): Promise<ReviewActionResult> {
  const e = i18nFor(locale).ta.review.errors;
  if (!user || !canWrite(user) || await isDemoOrg(user.orgId)) return { ok: false, error: e.forbidden };
  const parsed = Complete.safeParse(payload);
  if (!parsed.success) return { ok: false, error: e['bad note'] };
  const result = await completeReview(user, parsed.data.catalogId, parsed.data.note);
  if (!result.ok) return { ok: false, error: e[result.error] };
  return { ok: true };
}
