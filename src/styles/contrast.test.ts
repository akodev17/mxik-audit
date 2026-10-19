import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contrastRatio, parseColor } from './contrast';

const ratio = (a: string, b: string): number => contrastRatio(parseColor(a)!, parseColor(b)!);

describe('contrast', () => {
  it('parses hex and rgb() literals, and nothing else', () => {
    assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
    assert.deepEqual(parseColor('#2457F5'), { r: 36, g: 87, b: 245, a: 1 });
    assert.deepEqual(parseColor('rgb(16 24 32 / 0.45)'), { r: 16, g: 24, b: 32, a: 0.45 });
    assert.deepEqual(parseColor('rgba(0, 0, 0, 50%)'), { r: 0, g: 0, b: 0, a: 0.5 });
    assert.equal(parseColor('var(--color-fg)'), null);
    assert.equal(parseColor('red'), null);
  });

  it('matches the WCAG reference values', () => {
    assert.equal(ratio('#000000', '#ffffff').toFixed(2), '21.00');
    assert.equal(ratio('#ffffff', '#ffffff').toFixed(2), '1.00');
    assert.equal(ratio('#767676', '#ffffff').toFixed(2), '4.54');
    // The audited chip: danger text on its tint.
    assert.equal(ratio('#d23a2a', '#fcefed').toFixed(2), '4.27');
  });

  it('composites a translucent foreground over the backdrop', () => {
    assert.equal(ratio('rgb(0 0 0 / 0)', '#ffffff').toFixed(2), '1.00');
  });
});
