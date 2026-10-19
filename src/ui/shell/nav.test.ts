import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { helpHref, isActive, navGroups, switchTarget } from './nav';
import { paletteCommands } from './palette-model';
import { parseSidebar } from './prefs';

describe('shell navigation', () => {
  it('groups the links and shows upload only to writers', () => {
    const writer = navGroups({ canWrite: true, locale: 'uz' });
    assert.deepEqual(writer.map((g) => g.key), ['work', 'clients', 'knowledge', 'settings']);
    assert.deepEqual(writer.flatMap((g) => g.items.map((i) => i.href)), ['/dashboard', '/queue', '/clients', '/catalogs', '/upload', '/dictionary', '/activity', '/yordam', '/settings']);
    const viewer = navGroups({ canWrite: false, locale: 'ru' });
    assert.ok(!viewer.flatMap((g) => g.items).some((i) => i.key === 'upload'));
    assert.equal(viewer.flatMap((g) => g.items).find((i) => i.key === 'help')?.href, '/yordam/ru');
    assert.equal(helpHref('uz'), '/yordam');
  });

  it('marks a section active on its own path and below it only', () => {
    assert.equal(isActive('/catalogs', '/catalogs'), true);
    assert.equal(isActive('/catalogs/abc', '/catalogs'), true);
    assert.equal(isActive('/catalogsx', '/catalogs'), false);
    assert.equal(isActive('/clients', '/catalogs'), false);
  });

  it('moves client-specific pages to the new client and keeps every other page', () => {
    assert.equal(switchTarget('/clients/old', '', 'new'), '/clients/new');
    assert.equal(switchTarget('/clients/old/imports/x', '', 'new'), '/clients/new');
    assert.equal(switchTarget('/catalogs/abc', '?q=un', 'new'), '/catalogs');
    assert.equal(switchTarget('/upload', '?client=old', 'new'), '/upload');
    assert.equal(switchTarget('/upload', '', 'new'), null);
    assert.equal(switchTarget('/catalogs', '', 'new'), null);
    assert.equal(switchTarget('/clients', '', 'new'), null);
    assert.equal(switchTarget('/dashboard', '', 'new'), null);
  });

  it('reads the sidebar cookie, defaulting to automatic', () => {
    assert.equal(parseSidebar('collapsed'), 'collapsed');
    assert.equal(parseSidebar('expanded'), 'expanded');
    assert.equal(parseSidebar('wide'), 'auto');
    assert.equal(parseSidebar(undefined), 'auto');
  });
});

describe('palette commands', () => {
  it('offers upload to writers only and client switching only with a choice to make', () => {
    const writer = paletteCommands({ canWrite: true, locale: 'uz', clientCount: 3 }).map((c) => c.key);
    assert.deepEqual(writer, ['dashboard', 'queue', 'clients', 'catalogs', 'upload', 'dictionary', 'activity', 'help', 'notifications', 'settings', 'switchClient']);
    const viewer = paletteCommands({ canWrite: false, locale: 'uz', clientCount: 1 }).map((c) => c.key);
    assert.ok(!viewer.includes('upload'));
    assert.ok(!viewer.includes('switchClient'));
  });

  it('switching client opens a picker, not a page', () => {
    const cmd = paletteCommands({ canWrite: false, locale: 'ru', clientCount: 2 }).find((c) => c.key === 'switchClient');
    assert.equal(cmd?.href, null);
  });
});
