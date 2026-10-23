// Words for one activity log entry, shared by the log, the dashboard and the client page.
import { fmtNumber } from '@tasnivo/i18n/format';
import type { Locale } from '@tasnivo/i18n/i18n';
import type { AppDict } from '@tasnivo/i18n/i18n-app';
import type { ActivityEntry, ActivityRow } from '@/lib/pure/activity-groups';
import { SYSTEM_DECISION_ACTIONS } from '@/lib/workspace-url';

const SYSTEM: readonly string[] = SYSTEM_DECISION_ACTIONS;

/** A decision nobody made: dictionary auto-accept or carried over from the previous version, with no actor. */
export function isAutomaticRow(row: Pick<ActivityRow, 'action' | 'actorId'>): boolean {
  return row.actorId === null && SYSTEM.includes(row.action);
}

/** A run made only of automatic decisions gets its own title instead of a person's. */
export function isAutomaticEntry(entry: ActivityEntry): boolean {
  return entry.kind === 'event' ? isAutomaticRow(entry.row) : entry.rows.every(isAutomaticRow);
}

export function actorText(row: Pick<ActivityRow, 'actor' | 'actorId' | 'action'>, ta: AppDict): string {
  if (row.actor) return row.actor;
  if (isAutomaticRow(row)) return ta.firmX.log.automatic;
  return row.actorId ? ta.firmX.log.deletedUser : ta.firmX.log.system;
}

export function actionText(row: Pick<ActivityRow, 'action' | 'count'>, ta: AppDict, locale: Locale): string {
  const label = ta.activity.actions[row.action] ?? row.action;
  return row.count !== null && row.count > 1 ? `${label} (${fmtNumber(locale, row.count)})` : label;
}

export function catalogText(row: Pick<ActivityRow, 'catalogName' | 'catalogDeleted'>, ta: AppDict): string | null {
  if (row.catalogName) return row.catalogDeleted ? `${row.catalogName} (${ta.firmX.log.deletedCatalog})` : row.catalogName;
  return row.catalogDeleted ? ta.firmX.log.deletedCatalog : null;
}

/** The one-line title: an action, "12 decisions — Baraka.xlsx" for a folded run, "Automatic: 12 decisions — …" for the system's. */
export function entryTitle(entry: ActivityEntry, ta: AppDict, locale: Locale): string {
  if (entry.kind === 'event') return actionText(entry.row, ta, locale);
  const head = entry.rows[0];
  const catalog = head ? catalogText(head, ta) ?? '' : '';
  const n = fmtNumber(locale, entry.decisions);
  return isAutomaticEntry(entry) ? ta.firmX.log.autoGroup(n, catalog, entry.decisions) : ta.firmX.log.group(n, catalog, entry.decisions);
}

/** The row an entry is shown with: the event itself, or the newest event of a group. */
export function entryHead(entry: ActivityEntry): ActivityRow | undefined {
  return entry.kind === 'event' ? entry.row : entry.rows[0];
}
