// What a check found, in the viewer's language, from the finding's data. Pure.
// The audit's stored sentence is Uzbek prose and is never the explanation.
import type { AppDict } from '@tasnivo/i18n/i18n-app';
import type { ReasonFacts } from './ws-types';

type Input = { type: string; facts: ReasonFacts; noSuggestion: boolean };

/** Sentences for the drawer's "Tekshiruv natijasi": the check in general, then what applies to this row. */
export function reasonLines({ type, facts, noSuggestion }: Input, w: AppDict['wsX'], unit: (u: string) => string): string[] {
  const r = w.reason;
  const lines: (string | null | undefined)[] = [w.explain[type]];
  if (type === 'MISSING' && noSuggestion) lines.push(r.missingNone);
  if (type === 'NOT_FOUND' && facts.retired && facts.code) lines.push(r.notFoundRetired(facts.code));
  if (type === 'UNIT_CONFLICT' && facts.rowUnit && facts.requiredUnits.length > 0) lines.push(r.unit(facts.rowUnit, facts.requiredUnits.map(unit).join(' / ')));
  if (type === 'NOT_PURCHASED') {
    if (facts.purchasedOtherUnit && facts.rowUnit) lines.push(r.purchasedOtherUnit(facts.rowUnit));
    lines.push(r.purchaseNote);
  }
  if (type === 'PRIVILEGE_CODE') lines.push(facts.privilegeMismatch ? r.privilegeMismatch : r.privilegeCheck);
  if (type === 'PRIVILEGE_OPPORTUNITY') lines.push(r.opportunityCheck);
  if (type === 'RESTRICTED') {
    if (facts.restriction) lines.push(r.restricted(facts.restriction.code, facts.restriction.date, facts.restriction.inForce));
    if (noSuggestion) lines.push(r.restrictedNone);
  }
  if (type === 'TNVED_MISMATCH') {
    if (facts.tnved) lines.push(r.tnved(facts.tnved.code, facts.tnved.heading, facts.tnved.codeHeading));
    if (noSuggestion) lines.push(r.tnvedNone);
  }
  if (facts.afterUpdate) lines.push(r.afterUpdate);
  return lines.filter((l): l is string => Boolean(l));
}
