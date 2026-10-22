// Small text helpers for the workspace: counts, names in toasts, skipped reports. Pure.
import type { Skipped } from '@/lib/decide-many';
import { fmtNumber } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import type { AppDict } from '@/lib/i18n-app';
import type { GridRow } from '@/lib/workspace-rows';

type CountFn = (n: string, k: number) => string;

/** A count template with the number formatted for the locale and the raw number for the plural. */
export const count = (locale: Locale, fn: CountFn, n: number): string => fn(fmtNumber(locale, n), n);

/** Product names in toasts and announcements stay short. */
export function shortName(name: string, max = 60): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** "Skipped: 2 codes retired, 1 row already holds another code." or null when nothing was skipped. */
export function skippedText(skipped: Skipped, ta: AppDict, locale: Locale): string | null {
  const x = ta.wsX.toast;
  const parts = [
    skipped.archived > 0 ? count(locale, x.skippedArchived, skipped.archived) : null,
    skipped.conflict > 0 ? count(locale, x.skippedConflict, skipped.conflict) : null,
    skipped.noCode > 0 ? count(locale, x.skippedNoCode, skipped.noCode) : null,
    skipped.confirmOnly > 0 ? count(locale, x.skippedConfirmOnly, skipped.confirmOnly) : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? x.skipped(parts.join('; ')) : null;
}

/** The decision state of a row in words. */
export function decisionText(row: Pick<GridRow, 'decision' | 'mode'>, ta: AppDict): string {
  const a = ta.wsX.act;
  if (row.decision === 'pending') return a.pending;
  if (row.decision === 'rejected') return a.rejected;
  return row.mode === 'confirm' ? a.confirmed : a.accepted;
}
