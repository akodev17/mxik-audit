// Folds runs of decision events by one person on one catalogue into a single log entry
// ("12 decisions — Baraka catalogue"), as domain activity-groups.ts does. Generic over the row, so
// API rows (dates revived) fold the same way and keep their own type.

type Row = { action: string; actorId: string | null; catalogId: string | null; at: Date; count?: number | null };

/** Decision events that are folded together when one person makes many in a row. */
export const DECISION_EVENTS: readonly string[] = ['finding.accepted', 'finding.rejected', 'finding.bulk_accepted', 'finding.bulk_rejected', 'finding.auto_accepted', 'finding.carried_over'];

export type ActivityEntry<R extends Row> =
  | { kind: 'event'; row: R }
  | { kind: 'group'; rows: R[]; decisions: number; first: Date; last: Date };

/** Events further apart than this start a new group. */
export const GROUP_WINDOW_MS = 30 * 60_000;

function joins(prev: Row, next: Row, windowMs: number): boolean {
  return DECISION_EVENTS.includes(prev.action) && DECISION_EVENTS.includes(next.action)
    && prev.actorId === next.actorId
    && prev.catalogId !== null && prev.catalogId === next.catalogId
    && Math.abs(prev.at.getTime() - next.at.getTime()) <= windowMs;
}

/** Rows come newest first; consecutive decisions that belong together become one group of two or more. */
export function groupDecisions<R extends Row>(rows: readonly R[], windowMs = GROUP_WINDOW_MS): ActivityEntry<R>[] {
  const runs: R[][] = [];
  for (const row of rows) {
    const run = runs[runs.length - 1];
    const prev = run?.[run.length - 1];
    if (run && prev && joins(prev, row, windowMs)) run.push(row);
    else runs.push([row]);
  }
  return runs.map((run): ActivityEntry<R> => {
    const [only] = run;
    if (run.length === 1 && only) return { kind: 'event', row: only };
    const times = run.map((r) => r.at.getTime());
    return {
      kind: 'group',
      rows: run,
      decisions: run.reduce((n, r) => n + (r.count ?? 1), 0),
      first: new Date(Math.min(...times)),
      last: new Date(Math.max(...times)),
    };
  });
}
