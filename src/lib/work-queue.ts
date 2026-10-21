// The dashboard's work queue: which clients need something, in what order, and what the one
// action on each is. Pure, so the ordering rule is tested without a database.
import { attentionReasons, type ClientStats } from './client-stats';

export type QueueTier = 'overdue' | 'open' | 'other';
export type QueueAction = 'review' | 'client' | 'upload';
export type QueueEntry = { client: ClientStats; tier: QueueTier; action: QueueAction };

type Input = Pick<ClientStats, 'id' | 'name' | 'catalogId' | 'isDefault' | 'openRows' | 'updatePending' | 'overdueTasks'>;

const TIER_ORDER: Record<QueueTier, number> = { overdue: 0, open: 1, other: 2 };

function tierOf(c: Input): QueueTier {
  if (c.overdueTasks > 0) return 'overdue';
  return c.openRows > 0 ? 'open' : 'other';
}

/**
 * Clients with a reason to look at them, most urgent first: a missed monthly check, then the most
 * open risky rows, then new findings from a classifier update, then the rest by name. The action is
 * the review queue when rows are open, the client page when the problem is a check or a failed
 * audit, and an upload when nothing has been uploaded.
 */
export function workQueue<T extends Input & ClientStats>(clients: readonly T[], pending: ReadonlySet<string>): QueueEntry[] {
  return clients
    .filter((c) => attentionReasons(c).length > 0)
    .map((client): QueueEntry => ({
      client,
      tier: tierOf(client),
      action: client.openRows > 0 ? 'review' : !client.catalogId && !client.isDefault && !pending.has(client.id) ? 'upload' : 'client',
    }))
    .sort((a, b) =>
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier]
      || b.client.openRows - a.client.openRows
      || b.client.updatePending - a.client.updatePending
      || a.client.name.localeCompare(b.client.name));
}

export type IssueShare = { type: string; findings: number; rows: number; share: number };

/** Each check's share of all undecided findings; shares sum to 1, so every bar uses the same scale. */
export function issueShares(types: readonly { type: string; findings: number; rows: number }[]): IssueShare[] {
  const total = types.reduce((n, x) => n + x.findings, 0);
  return types.map((x) => ({ ...x, share: total > 0 ? x.findings / total : 0 }));
}

export const QUEUE_FILTERS = ['all', 'overdue', 'open', 'setup'] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];
export const QUEUE_SORTS = ['urgent', 'open', 'name', 'audited'] as const;
export type QueueSort = (typeof QUEUE_SORTS)[number];

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback;

/** The queue's two URL parameters; anything unknown falls back to "all" and "most urgent first". */
export function parseQueueParams(params: { qf?: unknown; qs?: unknown }): { filter: QueueFilter; sort: QueueSort } {
  return { filter: oneOf(QUEUE_FILTERS, params.qf, 'all'), sort: oneOf(QUEUE_SORTS, params.qs, 'urgent') };
}

const matches = (e: QueueEntry, filter: QueueFilter): boolean => {
  if (filter === 'overdue') return e.client.overdueTasks > 0;
  if (filter === 'open') return e.client.openRows > 0;
  if (filter === 'setup') return e.client.catalogId === null;
  return true;
};

/** How many entries each filter would show, so the chips can say so. */
export function queueFilterCounts(entries: readonly QueueEntry[]): Record<QueueFilter, number> {
  return Object.fromEntries(QUEUE_FILTERS.map((f) => [f, entries.filter((e) => matches(e, f)).length])) as Record<QueueFilter, number>;
}

/** Filters and orders the queue. "urgent" is the order workQueue already produced; the rest are plain attributes. */
export function arrangeQueue(entries: readonly QueueEntry[], filter: QueueFilter, sort: QueueSort): QueueEntry[] {
  const shown = entries.filter((e) => matches(e, filter));
  if (sort === 'open') return shown.sort((a, b) => b.client.openRows - a.client.openRows || a.client.name.localeCompare(b.client.name));
  if (sort === 'name') return shown.sort((a, b) => a.client.name.localeCompare(b.client.name));
  // Longest since the last audit first; a client never audited counts as the longest.
  if (sort === 'audited') return shown.sort((a, b) => (a.client.auditedAt?.getTime() ?? 0) - (b.client.auditedAt?.getTime() ?? 0) || a.client.name.localeCompare(b.client.name));
  return shown;
}
