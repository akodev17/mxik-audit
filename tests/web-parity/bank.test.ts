// The bank screens' browser copies of pure @tasnivo/domain/bank code
// (apps/web/src/app/(app)/bank/bank-pure.ts) must keep answering what the originals answer.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bank, type BankColumnMap, type BankConventions } from '@tasnivo/contracts/modules/bank';
import { formatDecimal as domainFormat } from '@tasnivo/domain/bank/decimal';
import { directionFor as domainDirection, mappingProblem as domainProblem, toColumnMap } from '@tasnivo/domain/bank/formats/index';
import { directionFor, formatDecimal, mappingProblem, STATEMENT_ACCEPT } from '@/app/(app)/bank/bank-pure';

describe('bank screens: web copies equal the domain', () => {
  const maps: BankColumnMap[] = [
    toColumnMap({ date: 0, debit: 1, credit: 2 }),
    toColumnMap({ date: 0, amount: 1 }),
    toColumnMap({ date: 0, amount: 1, direction: 2 }),
    toColumnMap({ amount: 1 }),
    toColumnMap({ date: 0, debit: 1 }),
    toColumnMap({}),
  ];
  const conventions = (direction: BankConventions['direction']): BankConventions => ({ dateOrder: 'dmy', decimal: 'auto', direction, negativeIs: 'debit', currency: 'UZS' });

  it('mappingProblem and directionFor', () => {
    for (const m of maps) {
      for (const d of ['columns', 'signed', 'flag'] as const) {
        assert.equal(mappingProblem(m, conventions(d)), domainProblem(m, conventions(d)));
        assert.equal(directionFor(m, d), domainDirection(m, d));
      }
    }
  });

  it('formatDecimal', () => {
    for (const v of ['0', '1', '-5', '1234567.8', '1000000', '0.000001', '-1234.56']) {
      assert.equal(formatDecimal(v), domainFormat(v));
      assert.equal(formatDecimal(v, ' ', ','), domainFormat(v, ' ', ','));
    }
  });
});

describe('statement picker', () => {
  it('offers every file the statement reader takes, as the contract lists them (review 30 Oct, R-B17)', () => {
    const offered = STATEMENT_ACCEPT.split(',');
    for (const ext of ['.xlsx', '.xls', '.csv', '.txt', '.zip', '.html', '.xml']) assert.ok(offered.includes(ext), ext);
    assert.deepEqual([...(bank.preview.multipart?.files.file.extensions ?? [])].sort(), [...offered].sort());
  });
});
