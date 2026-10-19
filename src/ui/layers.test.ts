import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { closeLayer, isTopLayer, layerCount, openLayer } from './layers';

describe('layers', () => {
  it('lets only the topmost overlay react to Escape', () => {
    const drawer = openLayer();
    const dialog = openLayer();
    const menu = openLayer();
    assert.equal(isTopLayer(menu), true);
    assert.equal(isTopLayer(dialog), false);
    assert.equal(isTopLayer(drawer), false);

    closeLayer(menu);
    assert.equal(isTopLayer(dialog), true);

    // Closing out of order (the drawer under the dialog) keeps the dialog on top.
    closeLayer(drawer);
    assert.equal(isTopLayer(dialog), true);
    closeLayer(dialog);
    assert.equal(layerCount(), 0);
    assert.equal(isTopLayer(dialog), false);
  });

  it('ignores closing an id twice', () => {
    const a = openLayer();
    closeLayer(a);
    closeLayer(a);
    assert.equal(layerCount(), 0);
  });
});
