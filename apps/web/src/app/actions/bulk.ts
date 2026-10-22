'use server';

import { z } from 'zod';
import { writer } from '@/lib/guard';
import { getI18n } from '@/lib/locale';
import { FilterInput } from '@tasnivo/domain/workspace-filter';
import {
  applyBulk, previewBulk, undoBulkFlags, type DryRunResult, type FlagUndoResult, type ManyOutcome,
} from '@tasnivo/domain/workspace-ops';

export type { DryRunResult, FlagUndoResult };

const Target = z.union([
  z.object({ ids: z.array(z.string().min(1)).min(1).max(20_000) }),
  z.object({ filter: FilterInput }),
]);

const Action = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accept') }),
  z.object({ kind: z.literal('reject') }),
  z.object({ kind: z.literal('assign'), code: z.string().regex(/^\d{17}$/) }),
  z.object({ kind: z.literal('flag'), flag: z.enum(['ask_client', 'resolved']).nullable() }),
]);

const Input = z.object({ catalogId: z.string().min(1), target: Target, action: Action });

export type BulkActionInput = z.infer<typeof Action>;

export type BulkOutcome = ManyOutcome;

/** Applies one action to the selected rows, or to every row of a filter (up to the cap). */
export async function bulkAction(payload: unknown): Promise<BulkOutcome> {
  const { t, locale } = await getI18n();
  const user = await writer();
  const parsed = Input.safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  const { catalogId, target, action } = parsed.data;
  return applyBulk(user, catalogId, target, action, locale);
}

/** How many rows an action would touch, before it runs. */
export async function bulkDryRun(payload: unknown): Promise<DryRunResult> {
  const { t, locale } = await getI18n();
  const user = await writer();
  const parsed = Input.safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  return previewBulk(user, parsed.data.catalogId, parsed.data.target, parsed.data.action, locale);
}

/** Puts back the flags one bulk flag action replaced. */
export async function undoBulkFlag(eventId: unknown): Promise<FlagUndoResult> {
  const { t, locale } = await getI18n();
  const user = await writer();
  const id = z.string().min(1).safeParse(eventId);
  if (!user || !id.success) return { ok: false, error: t.errorGeneric };
  return undoBulkFlags(user, id.data, locale);
}
