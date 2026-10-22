'use server';

// Review tasks of a catalogue. The rules and messages live in @tasnivo/domain/catalog-review
// (shared with the API); these add the session and the cache.
import { revalidatePath } from 'next/cache';
import { assignCatalogReview as assignFor, finishCatalogReview as finishFor, type ReviewActionResult } from '@tasnivo/domain/catalog-review';
import { writer } from '@/lib/guard';
import { getLocale } from '@/lib/locale';

export type { ReviewActionResult };

function revalidate(payload: unknown): void {
  revalidatePath(`/catalogs/${(payload as { catalogId: string }).catalogId}`);
  revalidatePath('/dashboard');
  revalidatePath('/notifications');
}

/** Hands a ready catalogue to a team member; refused for viewers, in a demo, and for anything outside the user's scope. */
export async function assignCatalogReview(payload: unknown): Promise<ReviewActionResult> {
  const result = await assignFor(await writer(), await getLocale(), payload);
  if (result.ok) revalidate(payload);
  return result;
}

/** Marks a review done: by its assignee or an admin, never twice, never in a demo. */
export async function finishCatalogReview(payload: unknown): Promise<ReviewActionResult> {
  const result = await finishFor(await writer(), await getLocale(), payload);
  if (result.ok) revalidate(payload);
  return result;
}
