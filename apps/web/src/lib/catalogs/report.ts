// What the catalogue header and report pages compute from API answers. Copies of pure
// @tasnivo/domain code (the web app no longer imports the domain); catalogs-drift.test.ts keeps
// them equal to the originals.
import type { AppDict } from '@tasnivo/i18n/i18n-app';
import type { ClassifierHealth, Me, PipelineMeta, ReportData } from './types';

export const canWrite = (user: Pick<Me, 'role'>): boolean => user.role === 'admin' || user.role === 'accountant';
export const isAdminRole = (user: Pick<Me, 'role'>): boolean => user.role === 'admin';

// ── report-summary.ts ────────────────────────────────────────────────────────────────────────

export type TypeLine = { type: string; findings: number; open: number; accepted: number; rejected: number };

/** One line per finding type: its findings in the catalogue, and the listed rows open, accepted or rejected. */
export function typeLines(data: Pick<ReportData, 'byType' | 'rows'>): TypeLine[] {
  return data.byType.map(({ type, count }) => {
    const rows = data.rows.filter((r) => r.type === type);
    return {
      type, findings: count,
      open: rows.filter((r) => r.decision === 'pending').length,
      accepted: rows.filter((r) => r.decision === 'accepted').length,
      rejected: rows.filter((r) => r.decision === 'rejected').length,
    };
  });
}

// ── pipeline-meta.ts ─────────────────────────────────────────────────────────────────────────

/** One sentence per reason the audit ran without part of the pipeline. */
export function degradedNotes(meta: PipelineMeta, ta: AppDict): string[] {
  const d = ta.matchX.degraded;
  return meta.degradedReasons.map((code) => {
    if (code === 'rerank_failed') return d.rerank_failed(meta.llmRowsFailed);
    if (code === 'vector_failed') return d.vector_failed(meta.vectorErrors);
    return d[code];
  });
}

// ── classifier-freshness.ts bannerReasons, from /api/health ──────────────────────────────────

export type BannerReason = 'stale' | 'failed';

/** Why the stale-classifier banner shows: older than 7 days (`stale`, as health reports it), or the last update failed. */
export function bannerReasons(health: ClassifierHealth): BannerReason[] {
  if (!health.takenAt) return [];
  const reasons: BannerReason[] = [];
  if (health.stale) reasons.push('stale');
  if (health.lastUpdate?.outcome === 'failed') reasons.push('failed');
  return reasons;
}

// ── reminder-dates.ts ────────────────────────────────────────────────────────────────────────

/** Uzbekistan has no daylight saving: local time is UTC+5 all year. */
const LOCAL_OFFSET_MS = 5 * 3_600_000;

/** Today in Tashkent as YYYY-MM-DD. */
export function localToday(now: Date): string {
  return new Date(now.getTime() + LOCAL_OFFSET_MS).toISOString().slice(0, 10);
}

// ── query-string.ts ──────────────────────────────────────────────────────────────────────────

type Params = Record<string, string | string[] | undefined>;

/** `path` with the current params, `change` applied on top (null or '' removes a key). */
export function withQuery(path: string, current: Params, change: Record<string, string | null> = {}): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (key in change) continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v) q.set(key, v);
  }
  for (const [key, value] of Object.entries(change)) if (value) q.set(key, value);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
