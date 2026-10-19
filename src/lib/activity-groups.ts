// Folds runs of decision events by one person on one catalogue into a single
// log entry ("12 decisions — Baraka catalogue"). Pure; works on one page of rows.
import type { ActivityRow } from './activity';

/** Decision events that are folded together when one person makes many in a row. */
export const DECISION_EVENTS: readonly string[] = ['finding.accepted', 'finding.rejected', 'finding.bulk_accepted', 'finding.bulk_rejected', 'finding.auto_accepted', 'finding.carried_over'];

export type ActivityEntry =
  | { kind: 'event'; row: ActivityRow }
  | { kind: 'group'; rows: ActivityRow[]; decisions: number; first: Date; last: Date };

/** Events further apart than this start a new group. */
export const GROUP_WINDOW_MS = 30 * 60_000;

const decisionsIn = (r: ActivityRow): number => r.count ?? 1;

function joins(prev: ActivityRow, next: ActivityRow, windowMs: number): boolean {
  return DECISION_EVENTS.includes(prev.action) && DECISION_EVENTS.includes(next.action)
    && prev.actorId === next.actorId
    && prev.catalogId !== null && prev.catalogId === next.catalogId
    && Math.abs(prev.at.getTime() - next.at.getTime()) <= windowMs;
}

/** Rows come newest first; consecutive decisions that belong together become one group of two or more. */
export function groupDecisions(rows: readonly ActivityRow[], windowMs = GROUP_WINDOW_MS): ActivityEntry[] {
  const runs: ActivityRow[][] = [];
  for (const row of rows) {
    const run = runs[runs.length - 1];
    const prev = run?.[run.length - 1];
    if (run && prev && joins(prev, row, windowMs)) run.push(row);
    else runs.push([row]);
  }
  return runs.map((run): ActivityEntry => {
    const [only] = run;
    if (run.length === 1 && only) return { kind: 'event', row: only };
    const times = run.map((r) => r.at.getTime());
    return {
      kind: 'group',
      rows: run,
      decisions: run.reduce((n, r) => n + decisionsIn(r), 0),
      first: new Date(Math.min(...times)),
      last: new Date(Math.max(...times)),
    };
  });
}
