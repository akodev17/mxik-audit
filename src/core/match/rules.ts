// Domain rules from the official guidance, encoded as score adjustments rather
// than hard filters, so a strong retrieval signal can still outvote a heuristic.
// Pure: no I/O, fully unit-testable.
import { matchKeyOf } from '../normalize/index.js';
import { unitsCompatible } from '../normalize/units.js';
import type { MxikCandidate } from './types.js';

/**
 * Prepared dishes deliberately have no detailed MXIK, so the correct answer is
 * the general code and the user should not be sent hunting for a specific one.
 * Folded keys, so both scripts and every apostrophe spelling hit.
 */
const PREPARED_DISH_TERMS = [
  'palov', 'osh', 'manti', 'mantı', 'kabob', 'shashlik', 'shourpa', 'shorva',
  'lagman', 'somsa', 'chuchvara', 'norin', 'dimlama', 'qovurma', 'shoʻrva',
  'plov', 'shashlyk', 'lagman', 'samsa', 'pelmeni', 'tushbera',
  'tayyor taom', 'tayyor ovqat', 'gotovoye blyudo', 'obshestvennoye pitaniye',
  'ovqatlanish', 'restoran', 'kafe', 'oshxona',
].map(matchKeyOf);

/** True when the product name reads as a prepared dish / food-service item. */
export function isPreparedDish(name: string): boolean {
  const key = matchKeyOf(name);
  if (!key) return false;
  const tokens = new Set(key.split(' '));
  return PREPARED_DISH_TERMS.some((term) => {
    if (!term) return false;
    // Multi-word terms are substring-matched; single words must be whole tokens
    // so "osh" does not fire inside "oshqozon".
    return term.includes(' ') ? key.includes(term) : tokens.has(term);
  });
}

export type RuleContext = {
  candidate: MxikCandidate;
  /** The catalogue row's own unit of measure, as written by the user. */
  rowUnit: string | null;
  /** Whether the product name reads as a prepared dish. */
  preparedDish: boolean;
};

export type RuleOutcome = {
  /** Additive adjustment to the calibrated confidence, before clamping. */
  adjustment: number;
  /** Human-readable notes, surfaced in the UI and the audit log. */
  notes: string[];
  /** True when the row's unit contradicts a strictly bound unit. */
  unitConflict: boolean;
};

const ADJUSTMENTS = {
  /** Base codes are officially sanctioned as "not an error"; prefer them. */
  baseCodePreferred: 0.05,
  /** An identifying code is only appropriate for a marked category. */
  identifyingUnmarked: -0.1,
  /** Same, but the portal never told us whether this code is marked. */
  identifyingUnknownMarking: -0.05,
  /** Identifying code for a genuinely marked category is the right shape. */
  identifyingMarked: 0.03,
  /** A prepared dish should land on the general code. */
  preparedDishBase: 0.08,
  preparedDishSpecific: -0.1,
  /** Row unit contradicts a strictly bound unit: probably the wrong code. */
  strictUnitConflict: -0.15,
} as const;

/** Evaluates every rule against one candidate. */
export function applyRules(ctx: RuleContext): RuleOutcome {
  const { candidate, rowUnit, preparedDish } = ctx;
  const notes: string[] = [];
  let adjustment = 0;

  if (candidate.isBase) {
    adjustment += ADJUSTMENTS.baseCodePreferred;
    notes.push('Base code (…000000), the sanctioned choice when no exact match exists.');
  } else if (candidate.isMarked === true) {
    adjustment += ADJUSTMENTS.identifyingMarked;
    notes.push('Identifying code for a digitally marked category.');
  } else if (candidate.isMarked === false) {
    adjustment += ADJUSTMENTS.identifyingUnmarked;
    notes.push('Identifying code, but the category is not digitally marked — a base code is usually safer.');
  } else {
    adjustment += ADJUSTMENTS.identifyingUnknownMarking;
    notes.push('Identifying code and the classifier does not state whether the category is marked.');
  }

  if (preparedDish) {
    if (candidate.isBase) {
      adjustment += ADJUSTMENTS.preparedDishBase;
      notes.push('Prepared dishes have no detailed MXIK; the general code is correct.');
    } else {
      adjustment += ADJUSTMENTS.preparedDishSpecific;
      notes.push('Prepared dish matched to a detailed code, which the classifier does not provide for these.');
    }
  }

  // Only a strict binding can conflict. Recommended units never produce findings.
  const unitConflict = candidate.unitBinding === 'strict'
    && !unitsCompatible(rowUnit, candidate.unitCanonical);
  if (unitConflict) {
    adjustment += ADJUSTMENTS.strictUnitConflict;
    notes.push(`Unit mismatch: row says "${rowUnit ?? ''}", code requires ${candidate.unitCanonical.join(' / ')}.`);
  }

  return { adjustment, notes, unitConflict };
}

/** The hierarchy path, which is the reranker's strongest disambiguation signal. */
export function hierarchyPath(candidate: MxikCandidate): string {
  return [candidate.groupName, candidate.className, candidate.positionName, candidate.subPositionName]
    .filter((s): s is string => Boolean(s))
    .join(' → ');
}
