import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WARN_AT as DOMAIN_WARN_AT } from '@tasnivo/domain/billing/limits';
import { meterTone, WARN_AT } from './plan-meter.js';

describe('plan usage meters', () => {
  it('warn at the domain threshold', () => {
    assert.equal(WARN_AT, DOMAIN_WARN_AT);
  });

  it('turn amber near the cap and red at it', () => {
    assert.equal(meterTone(7, 10), 'brand');
    assert.equal(meterTone(8, 10), 'warn');
    assert.equal(meterTone(10, 10), 'danger');
    assert.equal(meterTone(12, 10), 'danger');
  });
});
