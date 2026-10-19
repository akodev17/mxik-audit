// Words for one activity log entry, shared by the log, the dashboard and the client page.
import type { ActivityRow } from '@/lib/activity';
import type { ActivityEntry } from '@/lib/activity-groups';
import { fmtNumber } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import type { AppDict } from '@/lib/i18n-app';

export function actorText(row: Pick<ActivityRow, 'actor' | 'actorId'>, ta: AppDict): string {
  if (row.actor) return row.actor;
  return row.actorId ? ta.firmX.log.deletedUser : ta.activity.system;
}

export function actionText(row: Pick<ActivityRow, 'action' | 'count'>, ta: AppDict, locale: Locale): string {
  const label = ta.activity.actions[row.action] ?? row.action;
  return row.count !== null && row.count > 1 ? `${label} (${fmtNumber(locale, row.count)})` : label;
}

export function catalogText(row: Pick<ActivityRow, 'catalogName' | 'catalogDeleted'>, ta: AppDict): string | null {
  if (row.catalogName) return row.catalogDeleted ? `${row.catalogName} (${ta.firmX.log.deletedCatalog})` : row.catalogName;
  return row.catalogDeleted ? ta.firmX.log.deletedCatalog : null;
}

/** The one-line title: an action, or "12 decisions — Baraka.xlsx" for a folded run. */
export function entryTitle(entry: ActivityEntry, ta: AppDict, locale: Locale): string {
  if (entry.kind === 'event') return actionText(entry.row, ta, locale);
  const head = entry.rows[0];
  const catalog = head ? catalogText(head, ta) ?? '' : '';
  return ta.firmX.log.group(fmtNumber(locale, entry.decisions), catalog, entry.decisions);
}

/** The row an entry is shown with: the event itself, or the newest event of a group. */
export function entryHead(entry: ActivityEntry): ActivityRow | undefined {
  return entry.kind === 'event' ? entry.row : entry.rows[0];
}
