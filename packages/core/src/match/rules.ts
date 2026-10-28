// Domain rules from the official guidance, encoded as score adjustments rather
// than hard filters, so a strong retrieval signal can still outvote a heuristic.
// Pure: no I/O, fully unit-testable.
import { matchKeyOf, tokenize } from '../normalize/index.js';
import { kindOfUnit, resolveUnit, unitsCompatible } from '../normalize/units.js';
import { earnsIdentifying, identifyingMatch, type RowIdentity } from './identifying.js';
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
  /** The row's folded words (normalised tokens and synonym terms); absent = no word-based rule. */
  productTokens?: readonly string[];
  /** The row's brand, size and pack tokens (identifying.ts rowIdentity); absent = identifyingPreferred never fires. */
  identity?: RowIdentity;
};

/**
 * Metals a name can declare, as folded stems. In metal trade an unnamed metal is
 * plain carbon steel: "Лист г/к" is not the stainless "Лист горячекатаный"
 * (07219001001000007), which won 35 of the eval's sheet rows on its exactly
 * matching words (2026-10-22).
 */
const MATERIALS: Readonly<Record<string, readonly string[]>> = {
  stainless: ['nerjave', 'korrozionnostoyk', 'zanglamay'],
  aluminium: ['alyumin'],
  copper: ['medn'],
  brass: ['latun'],
  bronze: ['bronz'],
  titanium: ['titan'],
};

/** Where the default holds: metal semi-products (groups 072, 074-076) and steel tubes (7304-7306), not finished articles. */
const SEMI_PRODUCT = /^(072|074|075|076|07304|07305|07306)/;

function materialsIn(tokens: readonly string[]): Set<string> {
  const found = new Set<string>();
  for (const [material, stems] of Object.entries(MATERIALS)) {
    if (tokens.some((t) => stems.some((s) => t.startsWith(s)))) found.add(material);
  }
  return found;
}

/** Stable names of the rules, stored in match evidence and translated in the UI. */
export const RULE_KEYS = [
  'baseCodePreferred', 'identifyingUnmarked', 'identifyingUnknownMarking', 'identifyingMarked',
  'identifyingPreferred', 'preparedDishBase', 'preparedDishSpecific', 'strictUnitConflict',
  'recommendedUnitMatch', 'unitKindMismatch', 'unrequestedMaterial',
] as const;

export type RuleKey = (typeof RULE_KEYS)[number];

export type RuleOutcome = {
  /** Additive adjustment to the calibrated confidence, before clamping. */
  adjustment: number;
  /** Human-readable notes, surfaced in the UI and the audit log. */
  notes: string[];
  /** The rules that fired, in the order applied. */
  keys: RuleKey[];
  /** True when the row's unit contradicts a strictly bound unit. */
  unitConflict: boolean;
  /** Row tokens that earned identifyingPreferred (brand first); empty when it did not fire. */
  identifyingTokens: string[];
  /** identifyingPreferred fired on the brand, not on sizes alone. */
  identifyingBrand: boolean;
};

const ADJUSTMENTS: Record<RuleKey, number> = {
  /** Base codes are accepted in practice when nothing fits exactly; prefer them. */
  baseCodePreferred: 0.05,
  /** An identifying code is only appropriate for a marked category. */
  identifyingUnmarked: -0.1,
  /** Same, but the portal never told us whether this code is marked. */
  identifyingUnknownMarking: -0.05,
  /** Identifying code for a genuinely marked category is the right shape. */
  identifyingMarked: 0.03,
  /**
   * The row names this identifying code's brand, or its size, dosage, volume,
   * pack or model (identifying.ts). Larger than baseCodePreferred, so a name
   * that earns the identifying code ranks it above the base code.
   */
  identifyingPreferred: 0.08,
  /** A prepared dish should land on the general code. */
  preparedDishBase: 0.08,
  preparedDishSpecific: -0.1,
  /** Row unit contradicts a strictly bound unit: probably the wrong code. */
  strictUnitConflict: -0.15,
  /** Recommended binding: the row's unit is one the portal recommends for this code. */
  recommendedUnitMatch: 0.03,
  /**
   * Recommended binding: the row is sold by a measure (tonnes, metres, m²,
   * litres) and every recommended unit measures something else (pieces against
   * tonnes). Same-kind units (kg against tonnes) convert and a row sold in
   * pieces can hold anything, so neither fires. Small: a recommendation is not a rule.
   */
  unitKindMismatch: -0.05,
  /** A metal semi-product whose name declares a metal the row never mentions. */
  unrequestedMaterial: -0.05,
};

/** Evaluates every rule against one candidate. */
export function applyRules(ctx: RuleContext): RuleOutcome {
  const { candidate, rowUnit, preparedDish } = ctx;
  const notes: string[] = [];
  const keys: RuleKey[] = [];
  let adjustment = 0;
  const fire = (key: RuleKey, note: string): void => {
    adjustment += ADJUSTMENTS[key];
    keys.push(key);
    notes.push(note);
  };

  // The name earns an identifying code when it repeats the code's brand or size;
  // then the "a base code is usually safer" penalties do not apply. A marked
  // code keeps identifyingMarked and gets the preference on top.
  const identifying = ctx.identity && !candidate.isBase ? identifyingMatch(ctx.identity, candidate) : null;
  const earned = identifying !== null && earnsIdentifying(identifying);
  const identifyingTokens = earned ? [...(identifying.brand ? [identifying.brand] : []), ...identifying.attributes] : [];

  if (candidate.isBase) {
    fire('baseCodePreferred', 'Base code (…000000), the usual choice in practice when no exact match exists.');
  } else if (candidate.isMarked === true) {
    fire('identifyingMarked', 'Identifying code for a digitally marked category.');
  } else if (!earned && candidate.isMarked === false) {
    fire('identifyingUnmarked', 'Identifying code, but the category is not digitally marked — a base code is usually safer.');
  } else if (!earned) {
    fire('identifyingUnknownMarking', 'Identifying code and the classifier does not state whether the category is marked.');
  }
  if (earned) fire('identifyingPreferred', `The name repeats this identifying code's ${identifyingTokens.join(', ')}.`);

  if (preparedDish) {
    if (candidate.isBase) {
      fire('preparedDishBase', 'Prepared dishes have no detailed MXIK; the general code is correct.');
    } else {
      fire('preparedDishSpecific', 'Prepared dish matched to a detailed code, which the classifier does not provide for these.');
    }
  }

  // Only a strict binding can conflict. Recommended units never produce findings.
  const unitConflict = candidate.unitBinding === 'strict'
    && !unitsCompatible(rowUnit, candidate.unitCanonical);
  if (unitConflict) {
    fire('strictUnitConflict', `Unit mismatch: row says "${rowUnit ?? ''}", code requires ${candidate.unitCanonical.join(' / ')}.`);
  }

  if (ctx.productTokens && SEMI_PRODUCT.test(candidate.code)) {
    const asked = materialsIn(ctx.productTokens);
    const declared = materialsIn(tokenize(`${matchKeyOf(candidate.nameUz)} ${matchKeyOf(candidate.nameRu)}`));
    const extra = [...declared].filter((m) => !asked.has(m));
    if (extra.length > 0) fire('unrequestedMaterial', `The code is ${extra.join('/')}; the row names no such metal (unnamed means carbon steel).`);
  }

  // A recommended binding never conflicts (no UNIT_CONFLICT finding), but it
  // still says what the code is usually sold in: plastic fittings in pieces,
  // steel in tonnes. Unresolvable units on either side are never judged.
  if (candidate.unitBinding === 'recommended') {
    const row = resolveUnit(rowUnit);
    const recommended = (candidate.recommendedUnits ?? []).map(resolveUnit).filter((u) => u !== null);
    const rowKind = row ? kindOfUnit(row) : null;
    if (row && recommended.some((u) => u.id === row.id)) {
      fire('recommendedUnitMatch', `Row unit "${rowUnit ?? ''}" is one the classifier recommends for this code.`);
    } else if (rowKind && rowKind !== 'count' && recommended.length > 0
      // A piece can hold any quantity (a 2.5 m plinth is sold "шт"), so only a
      // measured row unit (tonnes, metres...) can contradict a recommendation.
      && recommended.every((u) => { const kind = kindOfUnit(u); return kind !== null && kind !== rowKind; })) {
      fire('unitKindMismatch', `Row is sold by ${rowKind}; this code is recommended in ${(candidate.recommendedUnits ?? []).join(' / ')}.`);
    }
  }

  return { adjustment, notes, keys, unitConflict, identifyingTokens, identifyingBrand: earned && identifying.brand !== null };
}

/** The hierarchy path, which is the reranker's strongest disambiguation signal. */
export function hierarchyPath(candidate: MxikCandidate): string {
  return [candidate.groupName, candidate.className, candidate.positionName, candidate.subPositionName]
    .filter((s): s is string => Boolean(s))
    .join(' → ');
}
