// How old the classifier copy may get before anyone is told, and when the daily
// job starts an update. Pure: callers pass the clock and what they read.

const DAY_MS = 86_400_000;

/** The banner appears when the newest snapshot is older than this. */
export const STALE_AFTER_DAYS = 7;
/** The daily job starts an update when the newest snapshot is older than this. */
export const UPDATE_AFTER_DAYS = 1;

/** How the last update ended; "failed" is only kept while no newer snapshot exists. */
export type LastUpdate =
  | { outcome: 'success'; at: Date; message: null }
  | { outcome: 'failed'; at: Date; message: string };

/** Whole days since the snapshot was taken; never negative (a clock a little behind is "today"). */
export function ageInDays(takenAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - takenAt.getTime()) / DAY_MS));
}

/** True when the snapshot is strictly older than `days` days. */
export function olderThan(takenAt: Date, days: number, now: Date): boolean {
  return now.getTime() - takenAt.getTime() > days * DAY_MS;
}

export type BannerReason = 'stale' | 'failed';

/**
 * Why the stale-classifier banner shows, if it does. `stale`: the snapshot is
 * older than 7 days. `failed`: the last update failed. Both can hold at once.
 * With no snapshot there is nothing to age; /api/health reports that case.
 */
export function bannerReasons(
  snapshot: { takenAt: Date } | null,
  lastUpdate: LastUpdate | null,
  now: Date,
): BannerReason[] {
  if (!snapshot) return [];
  const reasons: BannerReason[] = [];
  if (olderThan(snapshot.takenAt, STALE_AFTER_DAYS, now)) reasons.push('stale');
  if (lastUpdate?.outcome === 'failed') reasons.push('failed');
  return reasons;
}

/**
 * The last update, from what is recorded. A failure counts only while it is
 * newer than the newest snapshot: a later load (by any route) supersedes it.
 * Without a status record a snapshot still proves a successful update at its date.
 */
export function resolveLastUpdate(
  snapshot: { takenAt: Date } | null,
  recorded: LastUpdate | null,
): LastUpdate | null {
  if (recorded?.outcome === 'failed' && (!snapshot || recorded.at.getTime() > snapshot.takenAt.getTime())) return recorded;
  if (recorded?.outcome === 'success' && (!snapshot || recorded.at.getTime() >= snapshot.takenAt.getTime())) return recorded;
  return snapshot ? { outcome: 'success', at: snapshot.takenAt, message: null } : null;
}

export type UpdateDecision =
  | { run: true }
  | { run: false; reason: 'no-snapshot' | 'fresh' | 'running' };

/**
 * Whether the daily job starts a classifier update. Not without a snapshot: a
 * first import is a deliberate step (DEPLOY.md section 4), not a side effect of a cron.
 */
export function updateDecision(snapshot: { takenAt: Date } | null, running: boolean, now: Date): UpdateDecision {
  if (!snapshot) return { run: false, reason: 'no-snapshot' };
  if (running) return { run: false, reason: 'running' };
  if (!olderThan(snapshot.takenAt, UPDATE_AFTER_DAYS, now)) return { run: false, reason: 'fresh' };
  return { run: true };
}
