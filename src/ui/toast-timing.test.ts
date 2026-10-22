import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { remainingMs, TOAST_MS, toastDuration } from './toast-timing';

describe('toastDuration', () => {
  it('keeps a toast with an action (Undo) for at least 5 seconds', () => {
    assert.ok(toastDuration('ok', true) >= 5_000);
    assert.ok(toastDuration('error', true) >= 5_000);
  });

  it('keeps errors longer than confirmations', () => {
    assert.equal(toastDuration('ok', false), TOAST_MS.ok);
    assert.ok(toastDuration('error', false) > toastDuration('ok', false));
  });
});

describe('remainingMs', () => {
  it('is the time left, never negative', () => {
    assert.equal(remainingMs(5000, 3000), 2000);
    assert.equal(remainingMs(5000, 9000), 0);
  });
});
