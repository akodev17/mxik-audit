import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAmount, readAmount } from './amount.js';

describe('readAmount', () => {
  it('reads grouped thousands and decimals in every locale', () => {
    assert.equal(parseAmount('1 234 567,50'), 1234567.5);
    assert.equal(parseAmount('1.234.567,50'), 1234567.5);
    assert.equal(parseAmount('1,234,567.50'), 1234567.5);
    assert.equal(parseAmount('1,234,567'), 1234567);
    assert.equal(parseAmount('12,5'), 12.5);
    assert.equal(parseAmount('12 500 soʻm'), 12500);
    assert.equal(parseAmount('-7,25'), -7.25);
  });

  it('reads a single separator followed by exactly three digits as thousands, flagged ambiguous', () => {
    assert.deepEqual(readAmount('12,500'), { value: 12500, ambiguous: true });
    assert.deepEqual(readAmount('1.250'), { value: 1250, ambiguous: true });
  });

  it('is not ambiguous when the whole part rules thousands out', () => {
    assert.deepEqual(readAmount('0,500'), { value: 0.5, ambiguous: false });
    assert.deepEqual(readAmount('1234,567'), { value: 1234.567, ambiguous: false });
    assert.deepEqual(readAmount('1.1250'), { value: 1.125, ambiguous: false });
  });

  it('reads anything without digits as no number', () => {
    assert.equal(parseAmount(null), null);
    assert.equal(parseAmount('—'), null);
    assert.equal(parseAmount(''), null);
  });
});
