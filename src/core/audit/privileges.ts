// Privilege-linked codes, from the classifier's own privilege column. Pure.
// Says only what the data says: a code is linked to a privilege. Whether the
// privilege applies (period, conditions) is for the user and their adviser.
import type { Finding } from './checks.js';

/** Privilege ids as the export stores them; "0" and blanks mean none. */
export function privilegeIds(ids: readonly string[] | null | undefined): string[] {
  return (ids ?? []).filter((id) => id !== '' && id !== '0');
}

export type PrivilegeLabel = (id: string) => string;

const describe = (ids: readonly string[], label: PrivilegeLabel): string => ids.map(label).join('; ');

/** The row's own code carries a privilege. Riskier when the code does not fit the name. */
export function privilegeCodeFinding(code: string, ids: readonly string[], label: PrivilegeLabel, codeMismatched: boolean): Finding {
  return {
    type: 'PRIVILEGE_CODE',
    severity: codeMismatched ? 'medium' : 'info',
    suggestedMxik: null,
    confidence: null,
    alternatives: [],
    reason: `${code} kodi tasniflagichda soliq imtiyozi bilan bogʻlangan: ${describe(ids, label)}. `
      + (codeMismatched
        ? 'Kod tovar nomiga mos kelmaydi: imtiyoz asossiz qoʻllanishi mumkin, tekshiring.'
        : 'Tovar shu kodga haqiqatan mosligini va imtiyoz shartlarini tekshiring.'),
    wasRetired: false,
    evidence: null,
  };
}

/** The suggested code carries a privilege the row's code does not. Never a risk by itself. */
export function privilegeOpportunityFinding(suggested: string, ids: readonly string[], label: PrivilegeLabel): Finding {
  return {
    type: 'PRIVILEGE_OPPORTUNITY',
    severity: 'info',
    suggestedMxik: null,
    confidence: null,
    alternatives: [],
    reason: `Taklif etilgan ${suggested} kodi soliq imtiyozi bilan bogʻlangan (${describe(ids, label)}), hozirgi kod esa yoʻq. `
      + 'Imtiyoz shartlari va amal qilish muddatini mutaxassis bilan tekshiring.',
    wasRetired: false,
    evidence: null,
  };
}
