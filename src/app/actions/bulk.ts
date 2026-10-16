'use server';

import { z } from 'zod';
import { bulkApply } from '@/lib/bulk';
import { writer } from '@/lib/guard';
import { readFilter } from '@/lib/workspace';

const Input = z.object({
  catalogId: z.string().min(1),
  target: z.union([
    z.object({ ids: z.array(z.string().min(1)).min(1).max(20_000) }),
    z.object({ filter: z.object({ type: z.string().nullable(), q: z.string().max(100), pendingOnly: z.boolean(), commented: z.boolean().optional() }) }),
  ]),
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('accept') }),
    z.object({ kind: z.literal('reject') }),
    z.object({ kind: z.literal('assign'), code: z.string().regex(/^\d{17}$/) }),
    z.object({ kind: z.literal('flag'), flag: z.enum(['ask_client', 'resolved']).nullable() }),
  ]),
});

export type BulkActionInput = z.infer<typeof Input>['action'];

export type BulkOutcome = { ok: true; count: number; eventId: string | null; ids: string[] } | { ok: false };

/** Applies one action to the selected rows, or to every row of a filter. */
export async function bulkAction(payload: unknown): Promise<BulkOutcome> {
  const user = await writer();
  const parsed = Input.safeParse(payload);
  if (!user || !parsed.success) return { ok: false };
  const { catalogId, target, action } = parsed.data;
  const result = await bulkApply(
    user, catalogId,
    'ids' in target ? target : { filter: readFilter({ type: target.filter.type, q: target.filter.q, pending: target.filter.pendingOnly ? '1' : '0', comments: target.filter.commented ? '1' : '0' }) },
    action,
  );
  return result.ok ? { ok: true, count: result.count, eventId: result.eventId, ids: result.ids } : { ok: false };
}
