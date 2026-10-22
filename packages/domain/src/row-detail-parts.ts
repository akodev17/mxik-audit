// Pure parts of the row drawer's data: which alternatives to show, how a
// privilege's legal text reads, and the facts a check's explanation is built
// from (rendered in the viewer's language, never the audit's stored prose).

import { restrictionDate } from '@tasnivo/core/audit/checks';

/** Split points of the 17-digit code: guruh, sinf, pozitsiya, subpozitsiya, brend/atribut. */
export const LEVEL_SPLITS = [3, 5, 8, 11, 17] as const;

/** Data a check's explanation is built from. */
export type ReasonFacts = {
  /** The row's own code. */
  code: string | null;
  /** NOT_FOUND: the code was in an earlier classifier and has been retired. */
  retired: boolean;
  /** Found by a re-check after a classifier update, not by the original audit. */
  afterUpdate: boolean;
  /** UNIT_CONFLICT and NOT_PURCHASED: the row's unit as the file has it. */
  rowUnit: string | null;
  /** UNIT_CONFLICT: the units the code is strictly bound to. */
  requiredUnits: string[];
  /** NOT_PURCHASED: the code was bought, but in another unit. */
  purchasedOtherUnit: boolean;
  /** PRIVILEGE_CODE: the code does not fit the name, so the privilege is doubtful. */
  privilegeMismatch: boolean;
  /** RESTRICTED: the restricted code, its date as dd.mm.yyyy, and whether that date has passed. */
  restriction: { code: string; date: string; inForce: boolean } | null;
};

// The purchase check stores no structured flag for "bought in another unit";
// its sentence (src/core/audit/purchases.ts) is the only record of it.
const OTHER_UNIT = /boshqa o.lchov birligida/;

type FindingFacts = {
  type: string; severity: string; reason: string; wasRetired: boolean; snapshotId: number | null;
  existingMxik: string | null; unit: string | null; codeUnits: readonly string[];
  restrictedMxik?: string | null; restrictedFrom?: Date | null;
};

export function reasonFacts(f: FindingFacts, today: Date = new Date()): ReasonFacts {
  return {
    code: f.existingMxik,
    retired: f.type === 'NOT_FOUND' && f.wasRetired,
    afterUpdate: f.snapshotId !== null,
    rowUnit: f.unit,
    requiredUnits: f.type === 'UNIT_CONFLICT' ? [...f.codeUnits] : [],
    purchasedOtherUnit: f.type === 'NOT_PURCHASED' && OTHER_UNIT.test(f.reason),
    privilegeMismatch: f.type === 'PRIVILEGE_CODE' && f.severity !== 'info',
    restriction: f.type === 'RESTRICTED' && f.restrictedMxik && f.restrictedFrom
      ? { code: f.restrictedMxik, date: restrictionDate(f.restrictedFrom), inForce: f.restrictedFrom.getTime() <= today.getTime() }
      : null,
  };
}

/** A privilege's legal text without the source's doubled brackets, dot runs and stray spaces. */
export function cleanPrivilegeName(text: string): string {
  return text
    .replace(/\(\(/g, '(').replace(/\)\)/g, ')')
    .replace(/\s*\.{3,}\s*/g, ' … ')
    .replace(/…\s*\./g, '…')
    .replace(/\s+/g, ' ')
    .trim();
}

type Alt = { code: string; confidence: number };

/** How far below the best score a candidate from another classifier group may be and still be shown. */
export const OTHER_GROUP_MARGIN = 0.25;

/**
 * Alternatives in the order worth offering: candidates from the best
 * suggestion's classifier group first (by score), then other groups. A
 * candidate from an unrelated group far below the best is dropped.
 */
export function rankAlternatives<T extends Alt>(best: Alt | null, alternatives: readonly T[]): T[] {
  const byScore = (a: T, b: T): number => b.confidence - a.confidence;
  const others = alternatives.filter((a) => a.code !== best?.code);
  if (!best) return [...others].sort(byScore);
  const group = best.code.slice(0, LEVEL_SPLITS[0]);
  const same = others.filter((a) => a.code.slice(0, LEVEL_SPLITS[0]) === group);
  const near = others.filter((a) => a.code.slice(0, LEVEL_SPLITS[0]) !== group && a.confidence >= best.confidence - OTHER_GROUP_MARGIN);
  return [...same.sort(byScore), ...near.sort(byScore)];
}

/** Prefixes of a code, one per classifier level ("004", "00401", …, the full code). */
export function levelPrefixes(code: string): string[] {
  return LEVEL_SPLITS.map((to) => code.slice(0, to));
}
