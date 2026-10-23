// Which 1C bank operation a statement line is: the org's own rules first (remembered from a
// reviewer's correction or added by hand, highest priority first), then the built-in rules for
// the lines every statement has — tax payments, bank fees, salary, acquiring, transfers between
// the org's own accounts, loans — and last the plain incoming / outgoing payment of a named
// counterparty. A line no rule decides keeps `operation: null` (issue operation_missing); the
// AI may suggest one, never apply it. Pure; shared with the browser.
import type { BankOperation, BankRecordPayload, BankRuleKind } from '@tasnivo/contracts/modules/bank';
import { normalizeName } from './identifiers.js';

export type OrgRule = {
  id: string;
  kind: BankRuleKind;
  value: string;
  operation: BankOperation;
  cashFlowItem: string | null;
  priority: number;
  /** null = every client of the org. */
  clientId: string | null;
};

/** Who the statement belongs to, from its title rows: a line to or from them is a transfer between own accounts. */
export type Owner = { inn: string | null; account: string | null; name: string | null };

export type RuleHit = {
  operation: BankOperation;
  cashFlowItem: string | null;
  /** `rule:<id>` for an org rule, `rule:builtin:<name>` for a built-in one. */
  decidedBy: string;
  ruleId: string | null;
};

type Line = Pick<BankRecordPayload, 'direction' | 'purpose' | 'counterparty' | 'ourAccount'>;

/** Purpose text for matching: lower case, ё as е, apostrophes dropped, single spaces. */
export const purposeKey = (text: string): string => text.toLowerCase().replace(/ё/g, 'е').replace(/[ʻʼ'`’‘]/g, '').replace(/\s+/g, ' ').trim();

/** The value an org rule of this kind stores for a line (what "remember for this counterparty" saves). */
export function ruleValueFor(kind: BankRuleKind, line: Line, text?: string): string | null {
  switch (kind) {
    case 'inn_equals': return line.counterparty.inn;
    case 'counterparty_equals': return normalizeName(line.counterparty.name) || null;
    case 'purpose_contains': return purposeKey(text ?? line.purpose).slice(0, 200) || null;
    case 'amount_sign': return line.direction;
  }
}

export function orgRuleMatches(rule: Pick<OrgRule, 'kind' | 'value'>, line: Line): boolean {
  switch (rule.kind) {
    case 'inn_equals': return line.counterparty.inn !== null && line.counterparty.inn === rule.value;
    case 'counterparty_equals': return normalizeName(line.counterparty.name) !== '' && normalizeName(line.counterparty.name) === rule.value;
    case 'purpose_contains': return rule.value !== '' && purposeKey(line.purpose).includes(purposeKey(rule.value));
    case 'amount_sign': return line.direction === rule.value;
  }
}

// Built-in rules. Words only, no ИНН of the tax committee or the treasury: those are not in any
// source we have (integration-research.md), so an org that wants them adds an inn_equals rule.

/** "в т.ч. НДС" / "без НДС" in a supplier payment is not a tax payment. */
const VAT_MENTION = /(в\s*т\.?\s*ч\.?|в том числе|включая|без|shu jumladan|bilan|siz)\s*(ндс|qqs|налог)/u;
const TAX = /налог|уплата ндс|ндс в бюджет|\bендс\b|(^|[^\p{L}])(енп|есп|ндфл|инпс)([^\p{L}]|$)|подоходн|soliq|солиқ|qqs to.lov|бюджет/u;
const SALARY = /заработн|зарплат|з\/п|оплата труда|oylik|ish haqi|иш ҳақи|иш хаки|ойлик/u;
const BANK_FEE = /комисси|за обслуживание|обслуживание сч|услуги банка|xizmat haqi|bank xizmat|komissiya|дебетовый оборот|за ведение сч|абонентская плата/u;
const ACQUIRING = /smartvista|эквайринг|ekvayring|терминал|terminal|uzcard|humo|(^|[^\p{L}])pos([^\p{L}]|$)/u;
const TRANSFER = /между (своими|собственными) сч|перевод собственных|собственных средств|o.z hisob|ўз ҳисоб|own account/u;
const LOAN = /погашение кредит|погашение основного долга|выдача кредит|кредитн\S* договор|займ|qarz|kredit (to.lov|qaytar)/u;

type BuiltIn = { name: string; operation: BankOperation; test: (line: Line, purpose: string, owner: Owner) => boolean };

export const BUILT_IN_RULES: readonly BuiltIn[] = [
  {
    name: 'transfer', operation: 'transfer',
    test: (line, purpose, owner) => TRANSFER.test(purpose)
      || (owner.inn !== null && line.counterparty.inn === owner.inn)
      || (owner.name !== null && normalizeName(owner.name) !== '' && normalizeName(line.counterparty.name) === normalizeName(owner.name)),
  },
  { name: 'tax', operation: 'tax', test: (line, purpose) => line.direction === 'debit' && TAX.test(purpose) && !VAT_MENTION.test(purpose) },
  { name: 'salary', operation: 'salary', test: (line, purpose) => line.direction === 'debit' && SALARY.test(purpose) },
  { name: 'bank_fee', operation: 'bank_fee', test: (line, purpose) => line.direction === 'debit' && BANK_FEE.test(purpose) },
  { name: 'acquiring', operation: 'acquiring', test: (line, purpose) => line.direction === 'credit' && ACQUIRING.test(purpose) },
  { name: 'loan', operation: 'loan', test: (_line, purpose) => LOAN.test(purpose) },
  // The usual line: money from or to a named counterparty is a customer's or a supplier's payment.
  { name: 'counterparty_in', operation: 'payment_in', test: (line) => line.direction === 'credit' && (line.counterparty.inn !== null || line.counterparty.name.trim() !== '') },
  { name: 'counterparty_out', operation: 'payment_out', test: (line) => line.direction === 'debit' && (line.counterparty.inn !== null || line.counterparty.name.trim() !== '') },
];

/** Org rules in the order they are tried: priority, then the more specific kind, then the newest. */
const KIND_ORDER: Record<BankRuleKind, number> = { inn_equals: 0, counterparty_equals: 1, purpose_contains: 2, amount_sign: 3 };
export const sortRules = <R extends Pick<OrgRule, 'priority' | 'kind'>>(rules: readonly R[]): R[] =>
  [...rules].sort((a, b) => b.priority - a.priority || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

/**
 * The operation of a line: the first org rule that matches (rules for another client never apply),
 * else the first built-in rule; null when none decides (a line without a direction never matches).
 */
export function decideOperation(line: Line, rules: readonly OrgRule[], owner: Owner, clientId: string | null = null): RuleHit | null {
  if (!line.direction) return null;
  for (const rule of sortRules(rules)) {
    if (rule.clientId !== null && rule.clientId !== clientId) continue;
    if (orgRuleMatches(rule, line)) return { operation: rule.operation, cashFlowItem: rule.cashFlowItem, decidedBy: `rule:${rule.id}`, ruleId: rule.id };
  }
  const purpose = purposeKey(line.purpose);
  for (const b of BUILT_IN_RULES) {
    if (b.test(line, purpose, owner)) return { operation: b.operation, cashFlowItem: null, decidedBy: `rule:builtin:${b.name}`, ruleId: null };
  }
  return null;
}

/** Operations whose counterparty is the bank itself: a missing counterparty name is expected there. */
export const BANK_SIDE_OPERATIONS: ReadonlySet<BankOperation> = new Set(['bank_fee', 'acquiring']);
