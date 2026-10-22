import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placePanel, type Box } from './placement';

const viewport = { width: 400, height: 800 };
const box = (left: number, top: number, width = 100, height = 36): Box => ({ left, top, right: left + width, bottom: top + height });

describe('placePanel', () => {
  it('keeps the preferred side and alignment when the panel fits', () => {
    assert.deepEqual(placePanel(box(20, 100), { width: 200, height: 300 }, viewport, { side: 'bottom', align: 'start' }), { side: 'bottom', x: 0 });
    // End alignment: the right edges line up.
    assert.deepEqual(placePanel(box(250, 100), { width: 120, height: 300 }, viewport, { side: 'bottom', align: 'end' }), { side: 'bottom', x: -20 });
    assert.equal(placePanel(box(20, 500), { width: 200, height: 300 }, viewport, { side: 'top', align: 'start' }).side, 'top');
  });

  it('flips to the other side when there is not enough room', () => {
    // 800 - 636 - 4 - 8 = 152 px below, 600 - 4 - 8 = 588 above.
    assert.equal(placePanel(box(20, 600), { width: 200, height: 300 }, viewport, { side: 'bottom', align: 'start' }).side, 'top');
    // 50 - 4 - 8 = 38 px above.
    assert.equal(placePanel(box(20, 50), { width: 200, height: 300 }, viewport, { side: 'top', align: 'start' }).side, 'bottom');
  });

  it('takes the roomier side when neither fits', () => {
    const tall = { width: 200, height: 900 };
    assert.equal(placePanel(box(20, 500), tall, viewport, { side: 'bottom', align: 'start' }).side, 'top');
    assert.equal(placePanel(box(20, 200), tall, viewport, { side: 'bottom', align: 'start' }).side, 'bottom');
    assert.equal(placePanel(box(20, 200), tall, viewport, { side: 'top', align: 'start' }).side, 'bottom');
  });

  it('shifts horizontally to stay 8 px inside the viewport', () => {
    // Start-aligned near the right edge: left edge moves to 400 - 8 - 200 = 192.
    assert.equal(placePanel(box(300, 100), { width: 200, height: 100 }, viewport, { side: 'bottom', align: 'start' }).x, 192 - 300);
    // End-aligned near the left edge: 50 - 200 would be off-screen, so it starts at 8.
    assert.equal(placePanel(box(0, 100, 50), { width: 200, height: 100 }, viewport, { side: 'bottom', align: 'end' }).x, 8);
    // Wider than the viewport allows: pinned to the left margin.
    assert.equal(placePanel(box(150, 100), { width: 500, height: 100 }, viewport, { side: 'bottom', align: 'end' }).x, 8 - 150);
  });

  it('returns whole pixels', () => {
    const at = placePanel(box(300.4, 100), { width: 200.3, height: 100 }, viewport, { side: 'bottom', align: 'start' });
    assert.equal(Number.isInteger(at.x), true);
  });
});
