import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { keysReachWorkspace, ownsKeys, shortcutFor } from './shortcuts.js';

const key = (code: string, key: string, extra: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean }> = {}) =>
  ({ code, key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...extra });

describe('workspace shortcuts', () => {
  it('match the physical key, so a Cyrillic layout works', () => {
    assert.equal(shortcutFor(key('KeyJ', 'о')), 'next');
    assert.equal(shortcutFor(key('KeyK', 'л')), 'prev');
    assert.equal(shortcutFor(key('KeyR', 'к')), 'reject');
    assert.equal(shortcutFor(key('KeyU', 'г')), 'undo');
    assert.equal(shortcutFor(key('KeyN', 'т')), 'nextPending');
  });

  it('leaves / to the command palette', () => {
    assert.equal(shortcutFor(key('Slash', '/')), null);
    assert.equal(shortcutFor(key('Slash', '.')), null);
  });

  it('searches the catalogue with F on any layout, not with Ctrl+F or a held key', () => {
    assert.equal(shortcutFor(key('KeyF', 'f')), 'search');
    assert.equal(shortcutFor(key('KeyF', 'а')), 'search');
    assert.equal(shortcutFor(key('KeyF', 'f', { ctrlKey: true })), null);
    assert.equal(shortcutFor(key('KeyF', 'f', { repeat: true })), null);
  });

  it('opens help with ? on any layout', () => {
    assert.equal(shortcutFor(key('Slash', '?', { shiftKey: true })), 'help');
    assert.equal(shortcutFor(key('Digit7', '?', { shiftKey: true })), 'help');
  });

  it('never acts with modifiers, on shifted letters, or on a held-down decision key', () => {
    assert.equal(shortcutFor(key('KeyR', 'r', { ctrlKey: true })), null);
    assert.equal(shortcutFor(key('KeyR', 'R', { shiftKey: true })), null);
    assert.equal(shortcutFor(key('Enter', 'Enter', { repeat: true })), null);
    assert.equal(shortcutFor(key('KeyU', 'u', { repeat: true })), null);
    assert.equal(shortcutFor(key('KeyJ', 'j', { repeat: true })), 'next');
  });

  it('leaves keys alone when the target is not an element', () => {
    assert.equal(ownsKeys(null), false);
    assert.equal(ownsKeys({} as EventTarget), false);
  });
});

describe('keysReachWorkspace', () => {
  // A tiny tree: body > main > root > row, and body > header > button.
  type Tree = { parent: Tree | null; contains: (o: unknown) => boolean };
  const node = (parent: Tree | null = null): Tree => {
    const self: Tree = {
      parent,
      contains: (o) => { for (let n = o as Tree | null; n; n = n.parent) if (n === self) return true; return false; },
    };
    return self;
  };
  const body = node();
  const main = node(body);
  const root = node(main);
  const row = node(root);
  const header = node(body);
  const button = node(header);

  it('accepts focus on the body, as after a reload', () => {
    assert.equal(keysReachWorkspace(null, root, body), true);
    assert.equal(keysReachWorkspace(body, root, body), true);
  });

  it('accepts focus on <main>, where the shell leaves it after a client-side navigation', () => {
    assert.equal(keysReachWorkspace(main, root, body), true);
  });

  it('accepts focus inside the workspace', () => {
    assert.equal(keysReachWorkspace(root, root, body), true);
    assert.equal(keysReachWorkspace(row, root, body), true);
  });

  it('refuses focus in another part of the page', () => {
    assert.equal(keysReachWorkspace(button, root, body), false);
    assert.equal(keysReachWorkspace(header, root, body), false);
  });

  it('refuses everything while the workspace is not mounted', () => {
    assert.equal(keysReachWorkspace(main, null, body), false);
  });
});
