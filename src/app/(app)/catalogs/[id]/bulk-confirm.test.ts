import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BULK_CONFIRM_ABOVE, needsBulkConfirm } from './bulk-confirm.js';

describe('bulk confirmation', () => {
  it('lets a handful of hand-picked rows run at once', () => {
    assert.equal(needsBulkConfirm({ allFiltered: false, selected: 1, everyLoaded: false }), false);
    assert.equal(needsBulkConfirm({ allFiltered: false, selected: BULK_CONFIRM_ABOVE, everyLoaded: false }), false);
  });

  it('asks for a larger selection', () => {
    assert.equal(needsBulkConfirm({ allFiltered: false, selected: BULK_CONFIRM_ABOVE + 1, everyLoaded: false }), true);
    assert.equal(needsBulkConfirm({ allFiltered: false, selected: 83, everyLoaded: false }), true);
  });

  it('asks when the header checkbox took every loaded row, however few', () => {
    assert.equal(needsBulkConfirm({ allFiltered: false, selected: 3, everyLoaded: true }), true);
  });

  it('always asks for the whole filter', () => {
    assert.equal(needsBulkConfirm({ allFiltered: true, selected: 2, everyLoaded: false }), true);
  });
});
