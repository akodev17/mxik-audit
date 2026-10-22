import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  addressKey, internalTarget, isServerResponse, linkAddress, NAVIGATION_GIVE_UP_MS, routeBoundaryKey, routerFetchAddress, settleNudge, watchVerdict,
  type LinkClick, type Timer,
} from './navigation';

describe('routeBoundaryKey', () => {
  it('changes with the query on ordinary pages, so each address gets a fresh boundary', () => {
    assert.equal(routeBoundaryKey('/clients', ''), '/clients');
    assert.equal(routeBoundaryKey('/clients', 'filter=stale'), '/clients?filter=stale');
    assert.notEqual(routeBoundaryKey('/clients', 'filter=stale'), routeBoundaryKey('/clients', 'filter=empty'));
    assert.notEqual(routeBoundaryKey('/clients/a', ''), routeBoundaryKey('/clients/b', ''));
    assert.equal(routeBoundaryKey('/activity', 'page=2'), '/activity?page=2');
  });

  it('changes workspace filters and settings tabs in place, one boundary per catalogue or page', () => {
    assert.equal(routeBoundaryKey('/catalogs/x', 'type=MISSING&v=0'), '/catalogs/x');
    assert.equal(routeBoundaryKey('/catalogs/x', 'type=MISSING'), routeBoundaryKey('/catalogs/x', 'type=NOT_FOUND'));
    assert.equal(routeBoundaryKey('/catalogs/x', 'q=sut&row=f1'), routeBoundaryKey('/catalogs/x', 'q=sut'), 'removing ?row= keeps the open drawer');
    assert.notEqual(routeBoundaryKey('/catalogs/x', ''), routeBoundaryKey('/catalogs/y', ''));
    assert.equal(routeBoundaryKey('/settings', 'tab=plan'), routeBoundaryKey('/settings', 'tab=security'));
    assert.equal(routeBoundaryKey('/catalogs/x/diff', 'against=y'), '/catalogs/x/diff?against=y', 'only the workspace itself, not the pages under it');
  });

  it('keeps the upload wizard and the Telegram bind result mounted when they edit the address', () => {
    assert.equal(routeBoundaryKey('/upload', 'catalog=abc'), '/upload');
    assert.equal(routeBoundaryKey('/upload', ''), '/upload');
    assert.equal(routeBoundaryKey('/settings', 'tab=security&tg=bound'), routeBoundaryKey('/settings', 'tab=security'));
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

describe('linkAddress', () => {
  const click = (href: string | null, extra: Partial<LinkClick> = {}): LinkClick => ({ href, target: null, download: false, button: 0, modified: false, ...extra });
  const at = 'http://localhost:3000/clients?filter=empty';

  it('includes the current address (a repeated click on the open tab), but not a link to a part of the page', () => {
    assert.equal(linkAddress(click('/clients?filter=empty'), at), '/clients?filter=empty');
    assert.equal(linkAddress(click('/queue'), at), '/queue');
    assert.equal(linkAddress(click('#section'), at), null);
    assert.equal(linkAddress(click('/queue', { modified: true }), at), null);
  });
});

describe('addressKey and routerFetchAddress', () => {
  const origin = 'http://localhost:3000';

  it('spell one address one way', () => {
    assert.equal(addressKey('/settings?tab=plan&x=1'), addressKey('/settings?x=1&tab=plan'));
    assert.equal(addressKey('/queue?'), '/queue');
    assert.equal(addressKey('/clients?q=a b'), addressKey('/clients?q=a%20b'));
  });

  it('gives the address a router fetch was for, without its cache key', () => {
    assert.equal(routerFetchAddress('http://localhost:3000/queue?_rsc=1x2y', origin), '/queue');
    assert.equal(routerFetchAddress('http://localhost:3000/settings?tab=plan&_rsc=ab', origin), addressKey('/settings?tab=plan'));
    assert.equal(routerFetchAddress('http://localhost:3000/clients/abc', origin), null, 'a server action, not a router fetch');
    assert.equal(routerFetchAddress('https://other.example/queue?_rsc=1', origin), null);
  });
});

describe('watchVerdict', () => {
  it('waits while the server has not answered, and calls it stuck once the answer is there', () => {
    assert.equal(watchVerdict(false, 8_000), 'wait', 'a slow page is not a stuck one');
    assert.equal(watchVerdict(false, 24_000), 'wait');
    assert.equal(watchVerdict(true, 8_000), 'stuck');
  });

  it('gives up waiting for an answer that never comes', () => {
    assert.equal(watchVerdict(false, NAVIGATION_GIVE_UP_MS), 'stuck');
  });
});

describe('isServerResponse', () => {
  const origin = 'http://localhost:3000';
  const fetched = (name: string) => ({ initiatorType: 'fetch', name });

  it('counts router fetches and server actions', () => {
    assert.equal(isServerResponse(fetched('http://localhost:3000/dashboard?_rsc=1x2y'), origin), true);
    assert.equal(isServerResponse(fetched('http://localhost:3000/clients/abc'), origin), true, 'a server action posts to the page');
  });

  it('ignores api calls, assets, other origins and non-fetch resources', () => {
    assert.equal(isServerResponse(fetched('http://localhost:3000/api/account/export'), origin), false);
    assert.equal(isServerResponse(fetched('http://localhost:3000/_next/static/chunks/a.js'), origin), false);
    assert.equal(isServerResponse(fetched('https://example.com/dashboard'), origin), false);
    assert.equal(isServerResponse({ initiatorType: 'script', name: 'http://localhost:3000/dashboard' }, origin), false);
    assert.equal(isServerResponse({ initiatorType: 'img', name: 'http://localhost:3000/logo' }, origin), false);
  });
});

describe('settleNudge', () => {
  /** Timers on a fake clock; advance() runs what falls due, in order. */
  function clock() {
    let now = 0;
    let seq = 0;
    let due: { id: number; at: number; run: () => void }[] = [];
    const timer: Timer = {
      set: (run, ms) => { seq += 1; due.push({ id: seq, at: now + ms, run }); return seq; },
      clear: (handle) => { due = due.filter((d) => d.id !== handle); },
    };
    const advance = (ms: number): void => {
      const until = now + ms;
      for (;;) {
        const next = due.sort((a, b) => a.at - b.at)[0];
        if (!next || next.at > until) break;
        due = due.filter((d) => d !== next);
        now = next.at;
        next.run();
      }
      now = until;
    };
    return { timer, advance, now: () => now };
  }

  it('nudges once, the delay after a response', () => {
    const c = clock();
    const at: number[] = [];
    const n = settleNudge(() => at.push(c.now()), 50, c.timer);
    n.responded();
    c.advance(49);
    assert.deepEqual(at, []);
    c.advance(500);
    assert.deepEqual(at, [50]);
  });

  it('coalesces a burst, and still nudges at least the delay after its last response', () => {
    const c = clock();
    const at: number[] = [];
    const n = settleNudge(() => at.push(c.now()), 50, c.timer);
    for (let i = 0; i < 4; i++) { n.responded(); c.advance(10); }
    c.advance(500);
    assert.deepEqual(at, [50, 100], 'the last response came at 30 ms');
    n.responded();
    c.advance(500);
    assert.deepEqual(at, [50, 100, 590]);
  });

  it('stops', () => {
    const c = clock();
    let nudged = 0;
    const n = settleNudge(() => { nudged += 1; }, 50, c.timer);
    n.responded();
    n.stop();
    c.advance(500);
    assert.equal(nudged, 0);
  });
});
