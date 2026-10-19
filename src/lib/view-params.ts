// What a saved view stores, and how it maps to the workspace URL. Pure, so the
// client menu and the server share it. Fields added later are optional, so
// views saved before them still load.
import { z } from 'zod';
import { DECISION_FILTERS, FLAG_FILTERS } from './workspace-filter';

/** Grid columns a user may hide; product, row number and decision always show. */
export const OPTIONAL_COLUMNS = ['status', 'current', 'suggested', 'match'] as const;
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];

export const ViewParams = z.object({
  type: z.string().max(40).nullable(),
  q: z.string().max(100),
  /** Older views: true = pending only. `decision` wins when present. */
  pending: z.boolean(),
  comments: z.boolean(),
  sort: z.enum(['risk', 'row']),
  density: z.enum(['comfortable', 'compact']),
  grouped: z.boolean(),
  decision: z.enum(DECISION_FILTERS).optional(),
  flag: z.enum(FLAG_FILTERS).optional(),
  hidden: z.array(z.enum(OPTIONAL_COLUMNS)).max(OPTIONAL_COLUMNS.length).optional(),
});
export type ViewParams = z.infer<typeof ViewParams>;

/** Reads the `cols` URL value ("status,match") into hidden columns; unknown names are dropped. */
export function readHidden(raw: string | null | undefined): OptionalColumn[] {
  if (!raw) return [];
  const wanted = new Set(raw.split(','));
  return OPTIONAL_COLUMNS.filter((c) => wanted.has(c));
}

/** Query string that opens the workspace in this view. `v=0` marks it as chosen, so the default view is not applied again. */
export function viewQuery(p: ViewParams): string {
  const q = new URLSearchParams({ v: '0' });
  const decision = p.decision ?? (p.pending ? 'pending' : 'all');
  if (p.type) q.set('type', p.type);
  if (p.q) q.set('q', p.q);
  if (decision !== 'pending') q.set('dec', decision);
  if (p.flag && p.flag !== 'any') q.set('flag', p.flag);
  if (p.comments) q.set('comments', '1');
  if (p.sort !== 'risk') q.set('sort', p.sort);
  if (p.density === 'compact') q.set('density', 'compact');
  if (p.grouped) q.set('grouped', '1');
  if (p.hidden && p.hidden.length > 0) q.set('cols', p.hidden.join(','));
  return q.toString();
}
