import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ADMIN_BILLING_PAGE_SIZE, pageWindow } from './admin-billing';

describe('admin billing pages', () => {
  it('pages 50 orgs at a time, 1-based', () => {
    assert.equal(ADMIN_BILLING_PAGE_SIZE, 50);
    assert.deepEqual(pageWindow(253), { page: 1, pageSize: 50, pageCount: 6, skip: 0 });
    assert.deepEqual(pageWindow(253, 6), { page: 6, pageSize: 50, pageCount: 6, skip: 250 });
    assert.deepEqual(pageWindow(100, 2), { page: 2, pageSize: 50, pageCount: 2, skip: 50 });
  });

  it('clamps a page past the end to the last one and below 1 to the first', () => {
    assert.deepEqual(pageWindow(253, 99), { page: 6, pageSize: 50, pageCount: 6, skip: 250 });
    assert.deepEqual(pageWindow(253, 0), { page: 1, pageSize: 50, pageCount: 6, skip: 0 });
  });

  it('has one empty page when there is nothing to list', () => {
    assert.deepEqual(pageWindow(0, 3), { page: 1, pageSize: 50, pageCount: 1, skip: 0 });
  });

  it('takes a smaller page size', () => {
    assert.deepEqual(pageWindow(5, 3, 2), { page: 3, pageSize: 2, pageCount: 3, skip: 4 });
  });
});
