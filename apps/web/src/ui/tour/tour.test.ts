import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placeCard } from './tour-place';
import { clampIndex, STEP_KEYS, TOUR_STEPS, visibleSteps } from './tour-steps';
import { resolveTarget, spotlightRect, type Rect } from './tour-target';

const viewport = { width: 1440, height: 900 };
const card = { width: 352, height: 220 };
const rect = (left: number, top: number, width = 80, height = 36): Rect => ({ left, top, width, height });

describe('tour steps', () => {
  it('lists the fourteen steps in the plan order', () => {
    assert.deepEqual(TOUR_STEPS.map((s) => s.key), [...STEP_KEYS]);
    assert.equal(TOUR_STEPS.length, 14);
    assert.equal(TOUR_STEPS.at(-1)?.targets.length, 0);
  });

  it('falls back from a header tab to the more button', () => {
    for (const key of ['catalogs', 'queue', 'clients', 'products', 'bank', 'didox', 'onec', 'dictionary', 'activity'] as const) {
      assert.deepEqual(TOUR_STEPS.find((s) => s.key === key)?.targets, [`nav-${key}`, 'nav-more']);
    }
  });

  it('drops the upload step for users who may not change data', () => {
    const viewer = visibleSteps(TOUR_STEPS, { write: false, team: false }).map((s) => s.key);
    assert.equal(viewer.includes('upload'), false);
    assert.equal(viewer.length, 13);
    const writer = visibleSteps(TOUR_STEPS, { write: true, team: false }).map((s) => s.key);
    assert.deepEqual(writer, [...STEP_KEYS]);
  });

  it('requires every listed ability', () => {
    const steps = [{ key: 'welcome' as const, targets: [], requires: ['write' as const, 'team' as const] }];
    assert.equal(visibleSteps(steps, { write: true, team: false }).length, 0);
    assert.equal(visibleSteps(steps, { write: true, team: true }).length, 1);
  });

  it('keeps the index inside the step list', () => {
    assert.equal(clampIndex(-1, 14), 0);
    assert.equal(clampIndex(3, 14), 3);
    assert.equal(clampIndex(14, 14), 13);
    assert.equal(clampIndex(20, 13), 12);
    assert.equal(clampIndex(2.7, 14), 2);
    assert.equal(clampIndex(Number.NaN, 14), 0);
    assert.equal(clampIndex(5, 0), 0);
  });
});

describe('target resolution', () => {
  it('takes the first key that is on screen', () => {
    const onScreen = new Set(['nav-more', 'nav-bank']);
    const find = (key: string): string | null => (onScreen.has(key) ? key : null);
    assert.deepEqual(resolveTarget(['nav-bank', 'nav-more'], find), { key: 'nav-bank', found: 'nav-bank' });
    onScreen.delete('nav-bank');
    assert.deepEqual(resolveTarget(['nav-bank', 'nav-more'], find), { key: 'nav-more', found: 'nav-more' });
  });

  it('gives null when no key is on screen or there are no keys', () => {
    assert.equal(resolveTarget(['checklist'], () => null), null);
    assert.equal(resolveTarget([], () => 'x'), null);
  });

  it('pads the spotlight and keeps it inside the viewport', () => {
    assert.deepEqual(spotlightRect(rect(100, 100), viewport), { left: 94, top: 94, width: 92, height: 48 });
    assert.deepEqual(spotlightRect(rect(2, 0, 40, 20), viewport), { left: 0, top: 0, width: 48, height: 26 });
    assert.deepEqual(spotlightRect(rect(1420, 880, 40, 40), viewport), { left: 1414, top: 874, width: 26, height: 26 });
  });
});

describe('card placement', () => {
  it('centres the card when there is no target', () => {
    assert.deepEqual(placeCard(null, card, viewport), { side: 'center', left: 544, top: 340 });
  });

  it('prefers the side below the target, centred on it', () => {
    // A header tab: 12 px under its bottom edge, horizontally centred on it.
    assert.deepEqual(placeCard(rect(400, 10), card, viewport), { side: 'bottom', top: 58, left: 264 });
  });

  it('slides along the edge to stay inside the gutter', () => {
    // The account button at the right edge: the card's right edge stops 16 px short of the viewport.
    assert.deepEqual(placeCard(rect(1390, 12, 32, 32), card, viewport), { side: 'bottom', top: 56, left: 1072 });
    assert.equal(placeCard(rect(0, 10), card, viewport).left, 16);
  });

  it('goes above when there is no room below, then right, then left', () => {
    assert.equal(placeCard(rect(400, 800), card, viewport).side, 'top');
    // A tall target that fills the height: beside it.
    assert.deepEqual(placeCard(rect(100, 20, 400, 860), card, viewport), { side: 'right', top: 340, left: 512 });
    assert.equal(placeCard(rect(1000, 20, 400, 860), card, viewport).side, 'left');
  });

  it('centres when no side fits', () => {
    assert.equal(placeCard(rect(40, 20, 1360, 860), card, viewport).side, 'center');
    // A phone: the card is barely narrower than the screen, nothing fits beside a tall target.
    const phone = { width: 375, height: 667 };
    assert.equal(placeCard(rect(10, 60, 355, 560), { width: 343, height: 240 }, phone).side, 'center');
  });
});
