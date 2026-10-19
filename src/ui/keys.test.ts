import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isFilledTextField, nextIndex, trapIndex, typeaheadIndex } from './keys';

describe('nextIndex', () => {
  it('moves and wraps with the arrow keys', () => {
    assert.equal(nextIndex('ArrowDown', 0, 3), 1);
    assert.equal(nextIndex('ArrowDown', 2, 3), 0);
    assert.equal(nextIndex('ArrowUp', 0, 3), 2);
    assert.equal(nextIndex('ArrowUp', 2, 3), 1);
  });

  it('starts at the first or last item when nothing is focused', () => {
    assert.equal(nextIndex('ArrowDown', -1, 4), 0);
    assert.equal(nextIndex('ArrowUp', -1, 4), 3);
  });

  it('jumps with Home and End', () => {
    assert.equal(nextIndex('Home', 2, 5), 0);
    assert.equal(nextIndex('End', 1, 5), 4);
  });

  it('uses left and right in a horizontal list only', () => {
    assert.equal(nextIndex('ArrowRight', 0, 3, 'horizontal'), 1);
    assert.equal(nextIndex('ArrowLeft', 0, 3, 'horizontal'), 2);
    assert.equal(nextIndex('ArrowRight', 0, 3), null);
    assert.equal(nextIndex('ArrowDown', 0, 3, 'horizontal'), null);
  });

  it('ignores other keys and empty lists', () => {
    assert.equal(nextIndex('a', 0, 3), null);
    assert.equal(nextIndex('ArrowDown', -1, 0), null);
  });
});

describe('typeaheadIndex', () => {
  const labels = ['Eksport', 'Chop etish', 'Eslatma', 'Oʻchirish'];

  it('finds the next item starting with the letter, wrapping', () => {
    assert.equal(typeaheadIndex(labels, 'e', 0), 2);
    assert.equal(typeaheadIndex(labels, 'E', 2), 0);
    assert.equal(typeaheadIndex(labels, 'o', -1), 3);
  });

  it('returns null when nothing matches or the key is not a character', () => {
    assert.equal(typeaheadIndex(labels, 'z', 0), null);
    assert.equal(typeaheadIndex(labels, 'Enter', 0), null);
    assert.equal(typeaheadIndex(labels, ' ', 0), null);
  });
});

describe('isFilledTextField', () => {
  it('is true for text inputs and textareas that hold text', () => {
    assert.equal(isFilledTextField({ tagName: 'INPUT', type: 'text', value: 'sut' }), true);
    assert.equal(isFilledTextField({ tagName: 'input', type: 'search', value: '1' }), true);
    assert.equal(isFilledTextField({ tagName: 'TEXTAREA', value: 'izoh' }), true);
    assert.equal(isFilledTextField({ isContentEditable: true, textContent: 'x' }), true);
  });

  it('is false for empty fields, other controls and non-elements', () => {
    assert.equal(isFilledTextField({ tagName: 'INPUT', type: 'text', value: '' }), false);
    assert.equal(isFilledTextField({ tagName: 'INPUT', type: 'checkbox', value: 'on' }), false);
    assert.equal(isFilledTextField({ tagName: 'BUTTON' }), false);
    assert.equal(isFilledTextField(null), false);
    assert.equal(isFilledTextField('INPUT'), false);
  });
});

describe('trapIndex', () => {
  it('wraps from the last to the first element and back', () => {
    assert.equal(trapIndex(2, 3, false), 0);
    assert.equal(trapIndex(0, 3, true), 2);
  });

  it('lets the browser move focus inside the trap', () => {
    assert.equal(trapIndex(0, 3, false), null);
    assert.equal(trapIndex(2, 3, true), null);
  });

  it('enters the trap from the container itself', () => {
    assert.equal(trapIndex(-1, 3, false), 0);
    assert.equal(trapIndex(-1, 3, true), 2);
    assert.equal(trapIndex(-1, 0, false), null);
  });
});
