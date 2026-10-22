import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fittingTabs, helpHref, isActive, navGroups, switcherScope, switchTarget } from './nav';
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

  it('shows the team page only to administrators, right after the clients', () => {
    const hrefs = (canTeam: boolean): string[] => navGroups({ canWrite: true, canTeam, locale: 'uz' }).flatMap((g) => g.items.map((i) => i.href));
    assert.ok(!hrefs(false).includes('/team'));
    const withTeam = hrefs(true);
    assert.equal(withTeam[withTeam.indexOf('/clients') + 1], '/team');
    assert.ok(paletteCommands({ canWrite: true, canTeam: true, locale: 'uz', clientCount: 1 }).some((c) => c.key === 'team'));
    assert.ok(!paletteCommands({ canWrite: true, locale: 'uz', clientCount: 1 }).some((c) => c.key === 'team'));
  });

  it('fits as many header tabs as the row holds and moves the rest behind the more button', () => {
    const widths = [97, 67, 71, 63, 87, 62, 88, 91]; // the Uzbek tab row: 626 px of tabs, 640 with 2 px gaps
    assert.equal(fittingTabs(widths, 805, 70, 2), 8, 'wide header: every tab, no more button');
    assert.equal(fittingTabs(widths, 600, 70, 2), 6, 'the more button takes room too');
    // 1024 px window, 389 px for the row: the bug hid four tabs behind an invisible scroller.
    assert.equal(fittingTabs(widths, 389, 70, 2), 4);
    assert.equal(fittingTabs(widths, 60, 70, 2), 0, 'no room: everything in the menu');
    assert.equal(fittingTabs([], 300, 70, 2), 0);
  });

  it('marks a section active on its own path and below it only', () => {
    assert.equal(isActive('/catalogs', '/catalogs'), true);
    assert.equal(isActive('/catalogs/abc', '/catalogs'), true);
    assert.equal(isActive('/catalogsx', '/catalogs'), false);
    assert.equal(isActive('/clients', '/catalogs'), false);
  });

  it('makes every client switch visible: the new client\'s page, catalogues or filtered list', () => {
    assert.equal(switchTarget('/clients/old', '', 'new'), '/clients/new');
    assert.equal(switchTarget('/clients/old/imports/x', '', 'new'), '/clients/new');
    assert.equal(switchTarget('/catalogs/abc', '?q=un', 'new'), '/catalogs?client=new');
    assert.equal(switchTarget('/catalogs', '?client=all&page=3', 'new'), '/catalogs?client=new');
    assert.equal(switchTarget('/queue', '?type=MISSING&after=abc', 'n w'), '/queue?type=MISSING&client=n+w');
    assert.equal(switchTarget('/activity', '?client=old&page=2', 'new'), '/activity?client=new');
    assert.equal(switchTarget('/upload', '?client=old', 'new'), '/upload');
    assert.equal(switchTarget('/upload', '', 'new'), null);
    assert.equal(switchTarget('/clients', '', 'new'), '/clients/new');
    assert.equal(switchTarget('/dashboard', '', 'new'), '/clients/new');
    assert.equal(switchTarget('/settings', '?tab=team', 'a/b'), '/clients/a%2Fb');
  });

  it('says what the client control stands for on each page', () => {
    assert.deepEqual(switcherScope('/clients/c1', ''), { kind: 'client', id: 'c1', fallback: 'record' });
    assert.deepEqual(switcherScope('/clients/c1/purchases', ''), { kind: 'client', id: 'c1', fallback: 'record' });
    assert.deepEqual(switcherScope('/catalogs/k1', '?type=MISSING'), { kind: 'record' });
    assert.deepEqual(switcherScope('/catalogs', ''), { kind: 'active' });
    assert.deepEqual(switcherScope('/catalogs', '?client=all'), { kind: 'all' });
    assert.deepEqual(switcherScope('/catalogs', '?client=c2'), { kind: 'client', id: 'c2', fallback: 'all' });
    assert.deepEqual(switcherScope('/queue', ''), { kind: 'all' });
    assert.deepEqual(switcherScope('/queue', '?client=c3&type=MISSING'), { kind: 'client', id: 'c3', fallback: 'all' });
    assert.deepEqual(switcherScope('/activity', '?client=c4'), { kind: 'client', id: 'c4', fallback: 'all' });
    assert.deepEqual(switcherScope('/upload', ''), { kind: 'active' });
    assert.deepEqual(switcherScope('/upload', '?client=c5'), { kind: 'client', id: 'c5', fallback: 'all' });
    for (const firmWide of ['/dashboard', '/clients', '/dictionary', '/notifications', '/settings']) {
      assert.deepEqual(switcherScope(firmWide, ''), { kind: 'all' }, firmWide);
    }
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
