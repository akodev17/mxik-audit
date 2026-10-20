import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { internalTarget, routeBoundaryKey, type LinkClick } from './navigation';

describe('routeBoundaryKey', () => {
  it('changes with the query on ordinary pages, so each address gets a fresh boundary', () => {
    assert.equal(routeBoundaryKey('/clients', ''), '/clients');
    assert.equal(routeBoundaryKey('/clients', 'filter=stale'), '/clients?filter=stale');
    assert.notEqual(routeBoundaryKey('/clients', 'filter=stale'), routeBoundaryKey('/clients', 'filter=empty'));
    assert.notEqual(routeBoundaryKey('/clients/a', ''), routeBoundaryKey('/clients/b', ''));
    assert.equal(routeBoundaryKey('/activity', 'page=2'), '/activity?page=2');
  });

  it('gives each workspace filter its own boundary, but not the row it opens', () => {
    assert.equal(routeBoundaryKey('/catalogs/x', 'type=MISSING&v=0'), '/catalogs/x?type=MISSING&v=0');
    assert.notEqual(routeBoundaryKey('/catalogs/x', 'type=MISSING'), routeBoundaryKey('/catalogs/x', 'type=NOT_FOUND'));
    assert.equal(routeBoundaryKey('/catalogs/x', 'q=sut&row=f1'), routeBoundaryKey('/catalogs/x', 'q=sut'), 'removing ?row= keeps the open drawer');
    assert.notEqual(routeBoundaryKey('/catalogs/x', ''), routeBoundaryKey('/catalogs/y', ''));
  });

  it('keeps the upload wizard and the Telegram bind result mounted when they edit the address', () => {
    assert.equal(routeBoundaryKey('/upload', 'catalog=abc'), '/upload');
    assert.equal(routeBoundaryKey('/upload', ''), '/upload');
    assert.equal(routeBoundaryKey('/settings', 'tab=security&tg=bound'), routeBoundaryKey('/settings', 'tab=security'));
    assert.notEqual(routeBoundaryKey('/settings', 'tab=security'), routeBoundaryKey('/settings', 'tab=team'));
  });
});

const SRC = fileURLToPath(new URL('../..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('pages that rewrite their own address', () => {
  // Each one is covered by routeBoundaryKey above; a new one must be added there first (see ./navigation).
  const KNOWN = ['app/(app)/catalogs/[id]/workspace.tsx', 'app/(app)/settings/security-panel.tsx', 'app/(app)/upload/upload-wizard.tsx'];

  it('are only the ones the page boundary knows about', () => {
    const found = sources(SRC)
      .filter((file) => /history\.(replaceState|pushState)\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file).split('\\').join('/'))
      .sort();
    assert.deepEqual(found, KNOWN);
  });
});

describe('internalTarget', () => {
  const click = (href: string | null, extra: Partial<LinkClick> = {}): LinkClick => ({ href, target: null, download: false, button: 0, modified: false, ...extra });
  const at = 'http://localhost:3000/clients?filter=empty';

  it('returns the path and query of an in-app navigation', () => {
    assert.equal(internalTarget(click('/clients/abc'), at), '/clients/abc');
    assert.equal(internalTarget(click('/dashboard?x=1#top'), at), '/dashboard?x=1');
    assert.equal(internalTarget(click('?filter=stale'), at), '/clients?filter=stale');
  });

  it('ignores the current address, hash-only, external, api, new-tab and modified clicks', () => {
    assert.equal(internalTarget(click('/clients?filter=empty'), at), null);
    assert.equal(internalTarget(click('#section'), at), null);
    assert.equal(internalTarget(click('https://example.com/a'), at), null);
    assert.equal(internalTarget(click('/api/export?catalog=1'), at), null);
    assert.equal(internalTarget(click('/clients/abc', { target: '_blank' }), at), null);
    assert.equal(internalTarget(click('/clients/abc', { modified: true }), at), null);
    assert.equal(internalTarget(click('/clients/abc', { button: 1 }), at), null);
    assert.equal(internalTarget(click('mailto:a@b.uz'), at), null);
  });
});
