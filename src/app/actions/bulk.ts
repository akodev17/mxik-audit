'use server';

import { z } from 'zod';
import { bulkApply, bulkPreview, undoFlags, type BulkPreview, type BulkTarget, type FlagUndo } from '@/lib/bulk';
import type { Skipped } from '@/lib/decide-many';
import { writer } from '@/lib/guard';
import { getI18n } from '@/lib/locale';
import { FilterInput, readFilter } from '@/lib/workspace-filter';

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

const toTarget = (t: z.infer<typeof Target>): BulkTarget => ('ids' in t ? t : { filter: readFilter(t.filter) });

export type BulkOutcome = { ok: true; count: number; eventId: string | null; ids: string[]; skipped: Skipped } | { ok: false; error: string };

/** Applies one action to the selected rows, or to every row of a filter (up to the cap). */
export async function bulkAction(payload: unknown): Promise<BulkOutcome> {
  const { t, ta } = await getI18n();
  const user = await writer();
  const parsed = Input.safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  const { catalogId, target, action } = parsed.data;
  const result = await bulkApply(user, catalogId, toTarget(target), action);
  if (result.ok) return result;
  return { ok: false, error: result.error === 'code not in classifier' ? ta.msg.codeNotInClassifier : t.errorGeneric };
}

export type DryRunResult = ({ ok: true } & BulkPreview) | { ok: false; error: string };

/** How many rows an action would touch, before it runs. */
export async function bulkDryRun(payload: unknown): Promise<DryRunResult> {
  const { t } = await getI18n();
  const user = await writer();
  const parsed = Input.safeParse(payload);
  if (!user || !parsed.success) return { ok: false, error: t.errorGeneric };
  const result = await bulkPreview(user, parsed.data.catalogId, toTarget(parsed.data.target), parsed.data.action);
  return result.ok ? result : { ok: false, error: t.errorGeneric };
}

export type FlagUndoResult = ({ ok: true } & FlagUndo) | { ok: false; error: string };

/** Puts back the flags one bulk flag action replaced. */
export async function undoBulkFlag(eventId: unknown): Promise<FlagUndoResult> {
  const { t } = await getI18n();
  const user = await writer();
  const id = z.string().min(1).safeParse(eventId);
  if (!user || !id.success) return { ok: false, error: t.errorGeneric };
  const result = await undoFlags(user, id.data);
  return result.ok ? result : { ok: false, error: t.reviewUndoFailed };
}
