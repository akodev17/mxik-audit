// Where a finding's decision came from (Finding.decisionSource), and the audit
// actions of decisions nobody made by hand. Pure.
import type { AppDict } from '@tasnivo/i18n/i18n-app';

export const DECISION_SOURCES = ['manual', 'group', 'bulk', 'bulk_sure', 'dictionary', 'dictionary_auto', 'carry_over'] as const;
export type DecisionSource = (typeof DECISION_SOURCES)[number];

/** Accepted by the org's dictionary auto-accept setting, with no person involved. */
export const AUTO_ACCEPTED_ACTION = 'finding.auto_accepted';
/** Copied from the client's previous catalogue version. */
export const CARRIED_OVER_ACTION = 'finding.carried_over';
/** Decision actions written by the system; undo and history should list them with the manual ones. */
export const SYSTEM_DECISION_ACTIONS = [AUTO_ACCEPTED_ACTION, CARRIED_OVER_ACTION] as const;

const KNOWN = new Set<string>(DECISION_SOURCES);

export function readDecisionSource(value: unknown): DecisionSource | null {
  return typeof value === 'string' && KNOWN.has(value) ? (value as DecisionSource) : null;
}

/** True when no person decided this finding in this catalogue. */
export function isAutomatic(source: DecisionSource | null): boolean {
  return source === 'dictionary_auto' || source === 'carry_over';
}

export function decisionSourceLabel(source: DecisionSource, ta: AppDict): string {
  return ta.matchX.decisionSource[source];
}
