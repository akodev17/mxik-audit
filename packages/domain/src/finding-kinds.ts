// What each finding type asks of the reviewer. Pure, shared by the server
// (which code an acceptance records) and the grid (which buttons to show).

/** Checks that propose a replacement code. */
export const SUGGESTING_TYPES: ReadonlySet<string> = new Set(['MISSING', 'NOT_FOUND', 'MISMATCH', 'RESTRICTED', 'TNVED_MISMATCH']);

/** Checks where accepting means "the current code is right" (UNIT_CONFLICT: and fix the unit). */
export const CONFIRMING_TYPES: ReadonlySet<string> = new Set(['UNIT_CONFLICT', 'NOT_PURCHASED', 'PRIVILEGE_CODE']);

/** suggest: accept the proposed code. pick: choose one by hand. confirm: keep the current code. */
export type DecisionMode = 'suggest' | 'pick' | 'confirm';

type Kind = { type: string; suggestedMxik: string | null; rerankNone?: boolean };

/** True only when a code-suggesting check found nothing acceptable; other checks never suggest a code. */
export function noSuggestion(f: Kind): boolean {
  return SUGGESTING_TYPES.has(f.type) && (!f.suggestedMxik || f.rerankNone === true);
}

export function decisionMode(f: Kind & { currentLive: boolean }): DecisionMode {
  if (CONFIRMING_TYPES.has(f.type)) return f.currentLive ? 'confirm' : 'pick';
  if (SUGGESTING_TYPES.has(f.type)) return noSuggestion(f) ? 'pick' : 'suggest';
  return 'pick';
}

/** The code an acceptance records when the reviewer picked none: the suggestion, or the current code for a confirming check. */
export function acceptCode(f: Kind & { existingMxik: string | null }): string | null {
  if (CONFIRMING_TYPES.has(f.type)) return f.type === 'UNIT_CONFLICT' ? (f.suggestedMxik ?? f.existingMxik) : f.existingMxik;
  if (SUGGESTING_TYPES.has(f.type)) return noSuggestion(f) ? null : f.suggestedMxik;
  return null;
}
