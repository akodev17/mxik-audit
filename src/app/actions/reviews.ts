'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isDemoOrg } from '@/lib/demo';
import { writer } from '@/lib/guard';
import { getI18n } from '@/lib/locale';
import { assignReview, completeReview, NOTE_MAX, type ReviewError } from '@/lib/review-assignments';

export type ReviewActionResult = { ok: true; changed?: boolean } | { ok: false; error: string };

const Assign = z.object({
  catalogId: z.string().min(1).max(64),
  assigneeId: z.string().min(1).max(64),
  dueOn: z.string().max(10).nullable(),
  note: z.string().max(NOTE_MAX * 4).nullable(),
});
const Complete = z.object({ catalogId: z.string().min(1).max(64), note: z.string().max(NOTE_MAX * 4).nullable() });

async function words(): Promise<Record<ReviewError, string> & { forbidden: string }> {
  const { ta } = await getI18n();
  const r = ta.review.errors;
  return { ...r, forbidden: r.forbidden };
}

/** Hands a ready catalogue to a team member; refused for viewers, in a demo, and for anything outside the user's scope. */
export async function assignCatalogReview(payload: unknown): Promise<ReviewActionResult> {
  const e = await words();
  const user = await writer();
  if (!user || await isDemoOrg(user.orgId)) return { ok: false, error: e.forbidden };
  const parsed = Assign.safeParse(payload);
  if (!parsed.success) return { ok: false, error: e['bad note'] };
  const result = await assignReview(user, parsed.data);
  if (!result.ok) return { ok: false, error: e[result.error] };
  revalidatePath(`/catalogs/${parsed.data.catalogId}`);
  revalidatePath('/dashboard');
  revalidatePath('/notifications');
  return { ok: true, changed: result.changed };
}

/** Marks a review done: by its assignee or an admin, never twice, never in a demo. */
export async function finishCatalogReview(payload: unknown): Promise<ReviewActionResult> {
  const e = await words();
  const user = await writer();
  if (!user || await isDemoOrg(user.orgId)) return { ok: false, error: e.forbidden };
  const parsed = Complete.safeParse(payload);
  if (!parsed.success) return { ok: false, error: e['bad note'] };
  const result = await completeReview(user, parsed.data.catalogId, parsed.data.note);
  if (!result.ok) return { ok: false, error: e[result.error] };
  revalidatePath(`/catalogs/${parsed.data.catalogId}`);
  revalidatePath('/dashboard');
  revalidatePath('/notifications');
  return { ok: true };
}
