// Finding type names, shared by every screen (apps/web/src/ui/labels.ts) and the PDF report.
import type { Dict } from './i18n';

/** Finding type names in the dictionary's language. */
export function typeLabels(t: Dict): Record<string, string> {
  return {
    MISSING: t.typeMissing,
    NOT_FOUND: t.typeNotFound,
    MISMATCH: t.typeMismatch,
    UNIT_CONFLICT: t.typeUnitConflict,
    NOT_PURCHASED: t.typeNotPurchased,
    PRIVILEGE_CODE: t.typePrivilegeCode,
    PRIVILEGE_OPPORTUNITY: t.typePrivilegeOpportunity,
    RESTRICTED: t.typeRestricted,
    OTHER: t.typeOther,
  };
}
