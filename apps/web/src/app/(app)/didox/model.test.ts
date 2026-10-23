import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decimalText } from './model';

// statusFromIssues is held to the domain's statusFor in tests/web-parity/didox.test.ts.
describe('didox money text', () => {
  it('groups and rounds money from decimal strings, never through a float', () => {
    assert.equal(decimalText('22573600', { money: true }), '22 573 600');
    assert.equal(decimalText('2571.4368', { money: true }), '2 571,44');
    assert.equal(decimalText('24000.0768', { money: true }), '24 000,08');
    assert.equal(decimalText('999.995', { money: true }), '1 000');
    assert.equal(decimalText('99999999999999999.999', { money: true }), '100 000 000 000 000 000');
    assert.equal(decimalText('-1234.5', { money: true }), '-1 234,50');
    assert.equal(decimalText('1.5'), '1,5');
    assert.equal(decimalText('2000'), '2 000');
    assert.equal(decimalText(null), '—');
    assert.equal(decimalText('abc'), 'abc');
  });
});
