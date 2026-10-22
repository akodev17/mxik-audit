import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { orderSessions } from './session-order.js';

describe('orderSessions', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 23, 12, minutes));
  const rows = [{ id: 'a', lastSeenAt: at(1) }, { id: 'b', lastSeenAt: at(5) }, { id: 'c', lastSeenAt: at(3) }];

  it('puts this browser first, then the most recently active, without touching the input', () => {
    assert.deepEqual(orderSessions(rows, 'a').map((r) => r.id), ['a', 'b', 'c']);
    assert.deepEqual(orderSessions(rows, null).map((r) => r.id), ['b', 'c', 'a']);
    assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c']);
  });
});
