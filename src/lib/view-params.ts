// What a saved view stores, and how it maps to the workspace URL. Pure, so the
// client menu and the server share it.
import { z } from 'zod';

export const ViewParams = z.object({
  type: z.string().max(40).nullable(),
  q: z.string().max(100),
  pending: z.boolean(),
  comments: z.boolean(),
  sort: z.enum(['risk', 'row']),
  density: z.enum(['comfortable', 'compact']),
  grouped: z.boolean(),
});
export type ViewParams = z.infer<typeof ViewParams>;

/** Query string that opens the workspace in this view. `v=0` marks it as chosen, so the default view is not applied again. */
export function viewQuery(p: ViewParams): string {
  const q = new URLSearchParams({ v: '0' });
  if (p.type) q.set('type', p.type);
  if (p.q) q.set('q', p.q);
  if (!p.pending) q.set('pending', '0');
  if (p.comments) q.set('comments', '1');
  if (p.sort !== 'risk') q.set('sort', p.sort);
  if (p.density === 'compact') q.set('density', 'compact');
  if (p.grouped) q.set('grouped', '1');
  return q.toString();
}
