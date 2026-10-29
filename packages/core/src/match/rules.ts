// Domain rules from the official guidance, encoded as score adjustments rather
// than hard filters, so a strong retrieval signal can still outvote a heuristic.
// Pure: no I/O, fully unit-testable.
import { matchKeyOf, tokenize } from '../normalize/index.js';
import { headNouns, headStem } from '../normalize/russian.js';
import { kindOfUnit, resolveUnit, unitsCompatible } from '../normalize/units.js';
import { earnsIdentifying, identifyingMatch, type RowIdentity } from './identifying.js';
import type { MxikCandidate } from './types.js';

/**
 * The food-service group of the classifier: the menu (10202001: dishes, drinks
 * and set meals by family), the outlet's other services (10202002) and
 * catering (10202003). A row that reads as a cafe's (normalize/synonyms.ts, the
 * catering lexicon) belongs here, whatever foodstuff shares its words.
 */
export const CATERING_GROUP = '10202';

/** True for a code of the food-service group. */
export function isCateringCode(code: string): boolean {
  return code.startsWith(CATERING_GROUP);
}

export type RuleContext = {
  candidate: MxikCandidate;
  /** The catalogue row's own unit of measure, as written by the user. */
  rowUnit: string | null;
  /** Whether the row reads as a food-service item: a dish, a drink the outlet makes, or its service. */
  catering: boolean;
  /** The row's folded words (normalised tokens and synonym terms); absent = no word-based rule. */
  productTokens?: readonly string[];
  /** The row's brand, size and pack tokens (identifying.ts rowIdentity); absent = identifyingPreferred never fires. */
  identity?: RowIdentity;
  /** The Russian row's head noun as normalize/russian.ts headStem folds it; absent = headNounMismatch never fires. */
  head?: string | undefined;
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
  'identifyingPreferred', 'cateringPreferred', 'cateringOutside', 'strictUnitConflict',
  'recommendedUnitMatch', 'unitKindMismatch', 'unrequestedMaterial', 'headNounMismatch',
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
  /**
   * A food-service row belongs in the catering group (10202), whose menu codes
   * are named by family, not by dish; a foodstuff, seasoning or utensil that
   * shares the dish's words is the wrong group. Until 2026-10-28 this pair
   * preferred base codes for a dish, which the menu position does not have.
   */
  cateringPreferred: 0.08,
  cateringOutside: -0.1,
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
  /**
   * A Russian row names its product by a head noun ("Принтер", "Реле
   * защитное"); this code's Russian name offers only other nouns as what it is
   * ("Тонер для принтера", "Защитное стекло"), the row's noun at most in a
   * dependent phrase (normalize/russian.ts). Number-blind: "Принтеры всех
   * видов" names a printer. Same size as the other soft rules; -0.03 and -0.08
   * measured worse or no better on the procurement set (2026-10-29).
   */
  headNounMismatch: -0.05,
};

/** Evaluates every rule against one candidate. */
export function applyRules(ctx: RuleContext): RuleOutcome {
  const { candidate, rowUnit, catering } = ctx;
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

  // In the catering group the family codes (…000001 and up) are the answers
  // and the few base codes are other families, so the shape rules say nothing
  // there for a food-service row.
  const cateringHome = catering && isCateringCode(candidate.code);
  if (cateringHome) {
    fire('cateringPreferred', 'Food-service item: the catering group (10202) is its home.');
  } else if (candidate.isBase) {
    fire('baseCodePreferred', 'Base code (…000000), the usual choice in practice when no exact match exists.');
  } else if (candidate.isMarked === true) {
    fire('identifyingMarked', 'Identifying code for a digitally marked category.');
  } else if (!earned && candidate.isMarked === false) {
    fire('identifyingUnmarked', 'Identifying code, but the category is not digitally marked — a base code is usually safer.');
  } else if (!earned) {
    fire('identifyingUnknownMarking', 'Identifying code and the classifier does not state whether the category is marked.');
  }
  if (earned && !cateringHome) fire('identifyingPreferred', `The name repeats this identifying code's ${identifyingTokens.join(', ')}.`);

  if (catering && !cateringHome) {
    fire('cateringOutside', 'Food-service item matched outside the catering group: a foodstuff or utensil that shares its words.');
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

  // A code whose Russian name offers no noun at all (codes and brands only) is not judged.
  if (ctx.head) {
    const heads = [...headNouns(candidate.nameRu)];
    if (heads.length > 0 && !heads.some((h) => headStem(h) === ctx.head)) {
      fire('headNounMismatch', `The code names ${heads.slice(0, 3).join(', ')}; the row's product noun is not among them.`);
    }
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
