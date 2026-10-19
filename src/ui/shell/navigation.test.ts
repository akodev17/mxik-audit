import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { documentHref, documentLinkTarget, internalTarget, isSameRoute, type LinkClick } from './navigation';

const HERE = 'http://localhost:3000/clients?filter=stale';
const url = (path: string): URL => new URL(path, 'http://localhost:3000');
const click = (over: Partial<LinkClick>): LinkClick => ({ href: '/clients', target: null, download: false, button: 0, modified: false, ...over });

describe('isSameRoute', () => {
  it('is true for another query on the same path and for sibling records', () => {
    assert.equal(isSameRoute(url('/clients'), url('/clients?filter=stale')), true);
    assert.equal(isSameRoute(url('/clients?filter=stale'), url('/clients')), true);
    assert.equal(isSameRoute(url('/activity?page=2'), url('/activity?page=3')), true);
    assert.equal(isSameRoute(url('/clients/a'), url('/clients/b')), true);
    assert.equal(isSameRoute(url('/clients/a/purchases'), url('/clients/b/purchases')), true);
  });

  it('is false across routes, within one record and on the workspace', () => {
    assert.equal(isSameRoute(url('/clients'), url('/clients/a')), false, 'list to record');
    assert.equal(isSameRoute(url('/clients/a'), url('/clients')), false, 'record to list');
    assert.equal(isSameRoute(url('/clients/a'), url('/clients/a/purchases')), false);
    assert.equal(isSameRoute(url('/clients/a/purchases'), url('/clients/a/imports')), false);
    assert.equal(isSameRoute(url('/dashboard'), url('/queue?client=a')), false);
    assert.equal(isSameRoute(url('/clients'), url('/clients')), false, 'same address');
    assert.equal(isSameRoute(url('/clients'), url('/clients#list')), false, 'hash only');
    assert.equal(isSameRoute(url('/catalogs/x'), url('/catalogs/x?type=MISSING&v=0')), false, 'workspace chips keep the router');
    assert.equal(isSameRoute(url('/catalogs/x'), url('/catalogs/y')), true, 'another catalogue is a sibling record');
    assert.equal(isSameRoute(url('/clients'), new URL('https://example.com/clients?x=1')), false);
  });
});

describe('documentHref and documentLinkTarget', () => {
  it('returns the address for same-route targets only', () => {
    assert.equal(documentHref('/clients?filter=archived', HERE), '/clients?filter=archived');
    assert.equal(documentHref('?page=2', 'http://localhost:3000/activity'), '/activity?page=2');
    assert.equal(documentHref('/queue', HERE), null);
    assert.equal(documentHref('/clients?filter=stale', HERE), null);
  });

  it('leaves clicks the browser or another tab handles alone', () => {
    assert.equal(documentLinkTarget(click({}), HERE), '/clients');
    assert.equal(documentLinkTarget(click({ target: '_self' }), HERE), '/clients');
    assert.equal(documentLinkTarget(click({ modified: true }), HERE), null);
    assert.equal(documentLinkTarget(click({ button: 1 }), HERE), null);
    assert.equal(documentLinkTarget(click({ target: '_blank' }), HERE), null);
    assert.equal(documentLinkTarget(click({ download: true }), HERE), null);
    assert.equal(documentLinkTarget(click({ href: null }), HERE), null);
  });
});

describe('internalTarget', () => {
  const click = (href: string | null, extra: Partial<LinkClick> = {}): LinkClick => ({ href, target: null, download: false, button: 0, modified: false, ...extra });
  const at = 'http://localhost:3000/clients?filter=empty';

  it('returns the path and query of an in-app navigation', () => {
    assert.equal(internalTarget(click('/clients/abc'), at), '/clients/abc');
    assert.equal(internalTarget(click('/dashboard?x=1#top'), at), '/dashboard?x=1');
  });

  it('ignores hash-only, external, api, new-tab and modified clicks', () => {
    assert.equal(internalTarget(click('#section'), at), null);
    assert.equal(internalTarget(click('https://example.com/a'), at), null);
    assert.equal(internalTarget(click('/api/export?catalog=1'), at), null);
    assert.equal(internalTarget(click('/clients/abc', { target: '_blank' }), at), null);
    assert.equal(internalTarget(click('/clients/abc', { modified: true }), at), null);
    assert.equal(internalTarget(click('mailto:a@b.uz'), at), null);
  });
});
