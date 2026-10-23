// The dashboard's work queue (domain work-queue.ts, client-stats.ts attentionReasons and
// client-attention.ts clientAttention): which clients need something, in what order, and the one
// action on each. Generic over the client row, so the API's rows (dates revived) keep their type.
// tests/web-parity holds these to the originals.

/** The fields of a client row the queue reads. */
export type QueueClient = {
  id: string;
  name: string;
  catalogId: string | null;
  isDefault: boolean;
  openRows: number;
  updatePending: number;
  overdueTasks: number;
  auditedAt: Date | null;
};

export type PendingAudit = 'failed' | 'analyzing' | 'uploaded';

/** Why a client needs attention; the default client is never flagged just for having no catalogue. */
export type Reason = { kind: 'update' | 'open' | 'overdue' | 'empty'; count: number };
export type AttentionReason = Reason | { kind: PendingAudit; count: number };

export function attentionReasons(c: Pick<QueueClient, 'catalogId' | 'isDefault' | 'openRows' | 'updatePending' | 'overdueTasks'>): Reason[] {
  const reasons: Reason[] = [];
  if (!c.catalogId && !c.isDefault) reasons.push({ kind: 'empty', count: 0 });
  if (c.updatePending > 0) reasons.push({ kind: 'update', count: c.updatePending });
  if (c.openRows > 0) reasons.push({ kind: 'open', count: c.openRows });
  if (c.overdueTasks > 0) reasons.push({ kind: 'overdue', count: c.overdueTasks });
  return reasons;
}

/** attentionReasons, with "no catalogue" told apart from a failed, running or unstarted audit. */
export function clientAttention(c: Parameters<typeof attentionReasons>[0] & Pick<QueueClient, 'id'>, pending: ReadonlyMap<string, PendingAudit>): AttentionReason[] {
  const status = pending.get(c.id);
  return attentionReasons(c).map((r): AttentionReason => (r.kind === 'empty' && status ? { kind: status, count: 0 } : r));
}

export type QueueTier = 'overdue' | 'open' | 'other';
export type QueueAction = 'review' | 'client' | 'upload';
export type QueueEntry<C extends QueueClient = QueueClient> = { client: C; tier: QueueTier; action: QueueAction };

const TIER_ORDER: Record<QueueTier, number> = { overdue: 0, open: 1, other: 2 };

function tierOf(c: QueueClient): QueueTier {
  if (c.overdueTasks > 0) return 'overdue';
  return c.openRows > 0 ? 'open' : 'other';
}

/**
 * Clients with a reason to look at them, most urgent first: a missed monthly check, then the most
 * open risky rows, then new findings from a classifier update, then the rest by name.
 */
export function workQueue<C extends QueueClient>(clients: readonly C[], pending: ReadonlySet<string>): QueueEntry<C>[] {
  return clients
    .filter((c) => attentionReasons(c).length > 0)
    .map((client): QueueEntry<C> => ({
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
export function arrangeQueue<C extends QueueClient>(entries: readonly QueueEntry<C>[], filter: QueueFilter, sort: QueueSort): QueueEntry<C>[] {
  const shown = entries.filter((e) => matches(e, filter));
  if (sort === 'open') return shown.sort((a, b) => b.client.openRows - a.client.openRows || a.client.name.localeCompare(b.client.name));
  if (sort === 'name') return shown.sort((a, b) => a.client.name.localeCompare(b.client.name));
  // Longest since the last audit first; a client never audited counts as the longest.
  if (sort === 'audited') return shown.sort((a, b) => (a.client.auditedAt?.getTime() ?? 0) - (b.client.auditedAt?.getTime() ?? 0) || a.client.name.localeCompare(b.client.name));
  return shown;
}
