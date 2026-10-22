'use server';

import { z } from 'zod';
import { writer } from '@/lib/guard';
import { recordWrongSuggestion } from '@tasnivo/domain/suggestion-feedback';
import { WRONG_REASONS } from '@tasnivo/domain/wrong-reasons';

const Input = z.object({
  findingId: z.string().min(1),
  reason: z.enum(WRONG_REASONS),
  note: z.string().max(500).optional(),
});

/** "Taklif notoʻgʻri": records why, with the stage and label that produced the suggestion. */
export async function reportWrongSuggestion(payload: unknown): Promise<{ ok: boolean }> {
  const user = await writer();
  const parsed = Input.safeParse(payload);
  if (!user || !parsed.success) return { ok: false };
  return { ok: await recordWrongSuggestion(user, parsed.data) };
}
