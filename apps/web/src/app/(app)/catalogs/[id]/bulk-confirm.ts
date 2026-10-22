// When a bulk action asks before it runs. Pure, so the rule is testable.

/** A hand-picked selection up to this size runs at once; the undo toast is enough there. */
export const BULK_CONFIRM_ABOVE = 5;

/**
 * The whole filter, more than a handful of rows, or every loaded row (the
 * header checkbox) always goes through the dry-run confirmation.
 */
export function needsBulkConfirm(s: { allFiltered: boolean; selected: number; everyLoaded: boolean }): boolean {
  return s.allFiltered || s.everyLoaded || s.selected > BULK_CONFIRM_ABOVE;
}
