// Hints under the "open risky rows" and "reviewed" tiles (domain client-kpi.ts). A hint says
// something new, never the tile's value again.
import { fmtNumber, fmtPercent } from '@tasnivo/i18n/format';
import type { Locale } from '@tasnivo/i18n/i18n';

export type KpiWords = {
  share: (pct: string) => string;
  findingsMore: (n: string, count: number) => string;
  inQueue: string;
};

/** Findings are named only when some rows carry several; otherwise the open rows wait in the queue. */
export function openRowsHint(locale: Locale, w: KpiWords, openRows: number, pendingFindings: number): string | undefined {
  if (pendingFindings > openRows) return w.findingsMore(fmtNumber(locale, pendingFindings), pendingFindings);
  return openRows > 0 ? w.inQueue : undefined;
}

/** Share of risky rows reviewed, rounded down so an open row never reads as 100%. */
export function reviewedShare(locale: Locale, w: KpiWords, progress: { done: number; total: number }): string {
  const ratio = progress.total > 0 ? Math.floor((progress.done / progress.total) * 100) / 100 : 0;
  return w.share(fmtPercent(locale, ratio));
}

/** Rows reviewed out of risky rows; null when there is nothing to review (shown as a dash, never 100%). */
export function rowProgress(c: { riskyRows: number; openRows: number }): { done: number; total: number } | null {
  if (c.riskyRows === 0) return null;
  return { done: c.riskyRows - c.openRows, total: c.riskyRows };
}
