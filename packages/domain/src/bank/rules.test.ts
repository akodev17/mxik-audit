// Operation rules (org rules before built-ins), duplicate keys, the AI suggester's boundaries,
// labels for every code, and the reconciliation CSV.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BankRecordPayload } from '@tasnivo/contracts/modules/bank';
import { BANK_OPERATIONS } from '@tasnivo/contracts/modules/bank';
import { i18nFor } from '@tasnivo/i18n/locale';
import { batchPrompt, maskDigits, operationSuggester, parseReply, setOperationSuggester } from './ai.js';
import { duplicatesInFile, lineFingerprint } from './duplicates.js';
import { BANK_ISSUE_CODES, BANK_ISSUES, statusFromIssues, issue } from './issues.js';
import { DROP_REASONS, type StatementLine } from './parse.js';
import { reconcile, reconcileCsv } from './reconcile.js';
import { BUILT_IN_RULES, decideOperation, orgRuleMatches, ruleValueFor, type OrgRule, type Owner } from './rules.js';
import { applyRules } from './store.js';

const line = (over: Partial<BankRecordPayload> & { name?: string; inn?: string | null } = {}): BankRecordPayload => ({
  date: '2026-10-01', docNumber: '1', direction: 'debit', amount: '100', currency: 'UZS', ourAccount: '20208000900123456001',
  counterparty: { name: over.name ?? 'ООО «Альфа»', inn: over.inn === undefined ? '302345678' : over.inn, account: null, mfo: null, counterpartyId: null },
  purpose: 'Оплата по счету 15', reference: null, valueDate: null, operation: null, cashFlowItem: null, contract: null, decidedBy: null,
  ...over,
});
const owner: Owner = { inn: '301234567', account: '20208000900123456001', name: 'ООО «Тасниво Тест»' };
const op = (l: BankRecordPayload, rules: OrgRule[] = [], clientId: string | null = null): string | null => decideOperation(l, rules, owner, clientId)?.operation ?? null;

describe('built-in operation rules', () => {
  it('tax, salary, bank fee, acquiring, own transfer, loan by their words', () => {
    assert.equal(op(line({ purpose: 'Уплата НДС за сентябрь 2026 года', name: 'Казначейство', inn: null })), 'tax');
    assert.equal(op(line({ purpose: 'Перечисление ЕНП за 3 квартал' })), 'tax');
    assert.equal(op(line({ purpose: "Soliq to'lovi (QQS)" })), 'tax');
    assert.equal(op(line({ purpose: 'Перечисление заработной платы за сентябрь' })), 'salary');
    assert.equal(op(line({ purpose: 'Oylik ish haqi sentyabr' })), 'salary');
    assert.equal(op(line({ purpose: 'Комиссия за обслуживание счета', name: '', inn: null })), 'bank_fee');
    assert.equal(op(line({ purpose: 'погашение Дебетовый оборот', name: '', inn: null })), 'bank_fee');
    assert.equal(op(line({ direction: 'credit', purpose: 'SmartVista - Выручка по терминалу 123', name: '', inn: null })), 'acquiring');
    assert.equal(op(line({ direction: 'credit', purpose: 'Возврат', inn: '301234567' })), 'transfer', 'the org\'s own ИНН');
    assert.equal(op(line({ purpose: 'Перевод собственных средств' })), 'transfer');
    assert.equal(op(line({ purpose: 'Погашение кредита по договору 5' })), 'loan');
  });

  it('a supplier payment that mentions VAT is not a tax payment', () => {
    assert.equal(op(line({ purpose: 'Оплата за товар, в т.ч. НДС 12%' })), 'payment_out');
    assert.equal(op(line({ purpose: 'Оплата за услуги без налога' })), 'payment_out');
  });

  it('a named counterparty is a payment in or out; nothing named and no words decides nothing', () => {
    assert.equal(op(line({ direction: 'credit' })), 'payment_in');
    assert.equal(op(line()), 'payment_out');
    assert.equal(op(line({ name: '', inn: null, purpose: 'Перевод' })), null);
    assert.equal(op(line({ direction: null })), null, 'a line without a direction is never decided');
  });

  it('a credit with tax words is not a tax payment (a refund is decided by a person)', () => {
    assert.equal(op(line({ direction: 'credit', purpose: 'Возврат излишне уплаченного налога', name: '', inn: null })), null);
  });

  it('every built-in rule names an existing operation', () => {
    for (const r of BUILT_IN_RULES) assert.ok((BANK_OPERATIONS as readonly string[]).includes(r.operation), r.name);
  });
});

describe('org rules', () => {
  const rule = (o: Partial<OrgRule>): OrgRule => ({ id: 'r1', kind: 'purpose_contains', value: 'аренда', operation: 'other_out', cashFlowItem: 'Аренда', priority: 100, clientId: null, ...o });

  it('come before the built-ins, carry the cash-flow item and explain themselves', () => {
    const hit = decideOperation(line({ purpose: 'Оплата за АРЕНДУ офиса'.replace('АРЕНДУ', 'аренда') }), [rule({})], owner);
    assert.deepEqual(hit, { operation: 'other_out', cashFlowItem: 'Аренда', decidedBy: 'rule:r1', ruleId: 'r1' });
  });

  it('match by ИНН, by normalised name, by purpose text and by direction', () => {
    assert.equal(orgRuleMatches({ kind: 'inn_equals', value: '302345678' }, line()), true);
    assert.equal(orgRuleMatches({ kind: 'counterparty_equals', value: 'альфа' }, line({ name: '"Альфа" MChJ' })), true);
    assert.equal(orgRuleMatches({ kind: 'purpose_contains', value: 'по счету' }, line()), true);
    assert.equal(orgRuleMatches({ kind: 'amount_sign', value: 'credit' }, line()), false);
  });

  it('a rule learnt for one client does not decide another client\'s lines', () => {
    const r = rule({ kind: 'inn_equals', value: '302345678', clientId: 'client-a' });
    assert.equal(op(line(), [r], 'client-a'), 'other_out');
    assert.equal(op(line(), [r], 'client-b'), 'payment_out');
  });

  it('higher priority first, then the more specific kind', () => {
    const rules = [rule({ id: 'p', kind: 'purpose_contains', value: 'счету', operation: 'other_out' }), rule({ id: 'i', kind: 'inn_equals', value: '302345678', operation: 'loan' })];
    assert.equal(decideOperation(line(), rules, owner)?.ruleId, 'i');
    assert.equal(decideOperation(line(), [...rules, rule({ id: 'top', kind: 'amount_sign', value: 'debit', operation: 'tax', priority: 500 })], owner)?.ruleId, 'top');
  });

  it('what "remember" stores for a line', () => {
    assert.equal(ruleValueFor('inn_equals', line()), '302345678');
    assert.equal(ruleValueFor('counterparty_equals', line()), 'альфа');
    assert.equal(ruleValueFor('purpose_contains', line(), '  Аренда  Офиса '), 'аренда офиса');
  });

  it('applying the rules sets the operation, clears operation_missing and calms counterparty_missing on bank-side lines', () => {
    const fee = { rowIndex: 1, payload: line({ purpose: 'Комиссия банка', name: '', inn: null }), issues: [issue('counterparty_missing', 'counterparty.name')] };
    applyRules(fee, [], owner, null);
    assert.equal(fee.payload.operation, 'bank_fee');
    assert.equal(fee.payload.decidedBy, 'rule:builtin:bank_fee');
    assert.equal(statusFromIssues(fee.issues), 'valid');
    const unknown: StatementLine = { rowIndex: 2, payload: line({ name: '', inn: null, purpose: 'Перевод' }), issues: [] };
    applyRules(unknown, [], owner, null);
    assert.deepEqual(unknown.issues.map((i) => i.code), ['operation_missing']);
  });
});

describe('duplicate keys', () => {
  it('the same payment gives the same key; a different document number does not', () => {
    assert.equal(lineFingerprint(line()), lineFingerprint(line()));
    assert.notEqual(lineFingerprint(line()), lineFingerprint(line({ docNumber: '2' })));
    assert.notEqual(lineFingerprint(line()), lineFingerprint(line({ ourAccount: '20208000900123456002' })));
  });

  it('a bank reference, when present, is the key on its own', () => {
    assert.equal(lineFingerprint(line({ reference: 'TRX-1', amount: '5' })), lineFingerprint(line({ reference: 'TRX-1', amount: '7', date: '2026-10-02' })));
  });

  it('a line without date, amount or direction has no key', () => {
    assert.equal(lineFingerprint(line({ date: null })), null);
    assert.equal(lineFingerprint(line({ amount: null })), null);
  });

  it('finds the earlier twin in the same file', () => {
    assert.deepEqual(duplicatesInFile(['a', 'b', 'a', null, 'b', 'a']), [-1, -1, 0, -1, 1, 0]);
  });
});

describe('AI suggestions', () => {
  it('nothing leaves but purpose (long digit runs masked), the counterparty\'s name and the direction', () => {
    const prompt = batchPrompt([{ id: '7', purpose: 'Оплата на счет 2020 8000 9001 2345 6001, ИНН 302345678, сумма 100', counterparty: 'ООО Альфа', direction: 'debit' }]);
    assert.ok(!prompt.includes('2020'), prompt);
    assert.ok(!prompt.includes('302345678'), prompt);
    assert.ok(prompt.includes('сумма 100'), 'short numbers stay');
    assert.deepEqual(Object.keys((JSON.parse(prompt) as Record<string, unknown>[])[0] ?? {}), ['id', 'purpose', 'counterparty', 'direction']);
    assert.equal(maskDigits('tel 12345'), 'tel 12345');
  });

  it('a reply off the schema or for an unknown row is dropped; confidence is clamped', () => {
    const ids = new Set(['1', '2']);
    const out = parseReply(JSON.stringify({ rows: [{ id: '1', operation: 'tax', confidence: 1.4, reason: 'налог' }, { id: '9', operation: 'tax', confidence: 0.5, reason: '' }] }), ids);
    assert.deepEqual([...out.keys()], ['1']);
    assert.equal(out.get('1')?.confidence, 1);
    assert.equal(parseReply('not json', ids).size, 0);
    assert.equal(parseReply(JSON.stringify({ rows: [{ id: '2', operation: 'unknown_op', confidence: 0.5, reason: '' }] }), ids).size, 0);
  });

  it('no key, no suggester; the override wins', () => {
    assert.equal(operationSuggester({}), null);
    assert.equal(operationSuggester({ ANTHROPIC_API_KEY: 'k', MXIK_LLM_ENABLED: 'false' }), null);
    assert.ok(operationSuggester({ ANTHROPIC_API_KEY: 'k' }));
    setOperationSuggester(null);
    assert.equal(operationSuggester({ ANTHROPIC_API_KEY: 'k' }), null);
    setOperationSuggester(undefined);
  });
});

describe('labels', () => {
  for (const locale of ['uz', 'ru'] as const) {
    const b = i18nFor(locale).ta.bankX;
    it(`${locale}: every issue code, drop reason, operation and role has a label`, () => {
      for (const code of BANK_ISSUE_CODES) assert.ok((b.issues as Record<string, string>)[code], `issues.${code}`);
      assert.deepEqual(Object.keys(b.issues).sort(), [...BANK_ISSUE_CODES].sort(), 'no label without a code');
      for (const reason of DROP_REASONS) assert.ok(b.dropReasons[reason], `dropReasons.${reason}`);
      for (const o of BANK_OPERATIONS) assert.ok(b.operations[o], `operations.${o}`);
      for (const r of BUILT_IN_RULES) assert.ok((b.builtinRules as Record<string, string>)[r.name], `builtinRules.${r.name}`);
    });
  }

  it('severities: format errors keep a line unresolved, review warnings make it suspicious', () => {
    for (const code of ['date_missing', 'date_invalid', 'amount_missing', 'amount_invalid', 'amount_both_columns', 'direction_missing'] as const) assert.equal(BANK_ISSUES[code], 'error', code);
    for (const code of ['inn_invalid', 'account_invalid', 'counterparty_missing', 'purpose_missing', 'counterparty_unknown', 'duplicate_row'] as const) assert.equal(BANK_ISSUES[code], 'warning', code);
  });
});

describe('reconciliation CSV', () => {
  it('summary, then every line with its labels; formula-looking cells are neutralised', () => {
    const records = [
      { rowIndex: 3, status: 'valid' as const, payload: line({ direction: 'credit', amount: '1000', operation: 'payment_in' }), issues: [], note: null },
      { rowIndex: 4, status: 'unresolved' as const, payload: line({ date: null, purpose: '=HYPERLINK("x")' }), issues: [issue('date_missing', 'date')], note: null },
    ];
    const report = reconcile({ openingBalance: '0', closingBalance: '900', bankTotals: { debit: null, credit: null }, dropped: [] }, records);
    assert.equal(report.balanced, true);
    assert.deepEqual(report.unresolved, [{ rowIndex: 4, codes: ['date_missing'], text: 'ООО «Альфа» · =HYPERLINK("x")' }]);
    const b = i18nFor('ru').ta.bankX;
    const csv = reconcileCsv(report, records, {
      summary: 'Итог', opening: 'Вх', credits: 'Пр', debits: 'Рс', computed: 'Расч', closing: 'Исх', difference: 'Разн', columns: b.reconcile.csvColumns,
      operation: (o) => (o ? b.operations[o as 'payment_in'] : b.operations.none), status: (s) => s, issue: (c) => (b.issues as Record<string, string>)[c] ?? c,
    });
    assert.ok(csv.startsWith('﻿Итог'));
    assert.ok(csv.includes('Оплата от покупателя'));
    assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), csv);
  });
});
