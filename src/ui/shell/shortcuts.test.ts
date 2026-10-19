import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { foldText, matchesQuery } from './palette-model';
import { isPaletteShortcut, isTypingTarget, shortcutLabel, type KeyLike } from './shortcuts';

const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('palette shortcuts', () => {
  it('opens on Ctrl+K and Cmd+K by physical key, whatever the layout', () => {
    assert.equal(isPaletteShortcut(key('KeyK', { ctrlKey: true }), false), true);
    assert.equal(isPaletteShortcut(key('KeyK', { metaKey: true }), true), true, 'works while typing');
    assert.equal(isPaletteShortcut(key('KeyK'), false), false);
    assert.equal(isPaletteShortcut(key('KeyK', { ctrlKey: true, shiftKey: true }), false), false);
    assert.equal(isPaletteShortcut(key('KeyK', { ctrlKey: true, altKey: true }), false), false);
  });

  it('opens on "/" only when not typing', () => {
    assert.equal(isPaletteShortcut(key('Slash'), false), true);
    assert.equal(isPaletteShortcut(key('Slash'), true), false);
    assert.equal(isPaletteShortcut(key('Slash', { shiftKey: true }), false), false);
    assert.equal(isPaletteShortcut(key('NumpadDivide'), false), true);
    assert.equal(isPaletteShortcut(key('Slash', { isComposing: true }), false), false);
    assert.equal(isPaletteShortcut(key('Slash', { defaultPrevented: true }), false), false);
  });

  it('knows when the user is typing', () => {
    assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'text' }), true);
    assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'search' }), true);
    assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
    assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
    assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
    assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
    assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
    assert.equal(isTypingTarget(null), false);
  });

  it('names the shortcut for the platform', () => {
    assert.equal(shortcutLabel('MacIntel'), '⌘K');
    assert.equal(shortcutLabel('Win32'), 'Ctrl K');
  });
});

describe('palette matching', () => {
  it('folds case and the Uzbek apostrophes', () => {
    assert.equal(foldText('  Lugʻatni   OCHISH '), 'lugatni ochish');
    assert.equal(matchesQuery('Lugʻatni ochish', [], "lug'at"), true);
    assert.equal(matchesQuery('Открыть каталоги', ['Каталоги'], 'катал'), true);
    assert.equal(matchesQuery('Bosh sahifani ochish', ['Bosh sahifa'], 'katalog'), false);
    assert.equal(matchesQuery('Anything', [], '  '), true);
  });
});
