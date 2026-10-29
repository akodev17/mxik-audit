import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { FeatureState as PrismaFeatureState } from '@prisma/client';
import { taRu } from '@tasnivo/i18n/i18n-app-ru';
import { taUz } from '@tasnivo/i18n/i18n-app';
import {
  allEnabled, FEATURE_MODULES, FEATURE_STATES, MODULE_KEYS, modulesOfApi, modulesOfRoute, statesFrom, strictest, ttlCache, underPrefix,
} from './feature-modules';
import { allEndpoints } from './registry';

const modules = Object.values(FEATURE_MODULES);

describe('module registry', () => {
  it('has unique keys, and no route or API prefix appears twice', () => {
    assert.equal(new Set(MODULE_KEYS).size, MODULE_KEYS.length);
    const routes = modules.flatMap((m) => m.routes);
    const api = modules.flatMap((m) => m.api);
    assert.deepEqual(routes.filter((r, i) => routes.indexOf(r) !== i), []);
    assert.deepEqual(api.filter((p, i) => api.indexOf(p) !== i), []);
  });

  it('every entry has a label, a description, a route and an API prefix', () => {
    for (const [key, m] of Object.entries(FEATURE_MODULES)) {
      assert.match(key, /^[a-z][a-z0-9_]*$/, key);
      assert.ok(m.label && m.description, key);
      assert.ok(m.routes.length > 0 && m.api.length > 0, key);
    }
  });

  it('route prefixes are pages of the signed-in app, and API prefixes cover registry endpoints', () => {
    for (const route of modules.flatMap((m) => m.routes)) {
      // Tests run from the repository root (scripts/test.mjs).
      assert.ok(existsSync(join('apps', 'web', 'src', 'app', '(app)', route.slice(1))), `no page folder for ${route}`);
    }
    const paths = allEndpoints().map((e) => e.path.replace(/\{\w+\}/g, 'x'));
    for (const prefix of modules.flatMap((m) => m.api)) {
      assert.ok(prefix.startsWith('/api/'), prefix);
      assert.ok(paths.some((p) => underPrefix(p, prefix)), `${prefix} matches no endpoint`);
    }
  });

  it('never covers the frame, the admin pages, the module states or the upload options the other modules read', () => {
    for (const path of ['/api/shell', '/api/modules', '/api/admin/features', '/api/dashboard', '/api/upload/options', '/api/auth/me', '/api/v1/catalogs']) {
      assert.deepEqual(modulesOfApi(path), [], path);
    }
    for (const path of ['/dashboard', '/admin/features', '/coming-soon/didox', '/settings', '/clients/c1']) assert.deepEqual(modulesOfRoute(path), [], path);
  });

  it('states are the Prisma enum, and every module has its name and description in Uzbek and Russian', () => {
    assert.deepEqual([...FEATURE_STATES], Object.values(PrismaFeatureState));
    assert.deepEqual(Object.keys(taUz.featuresX.modules), [...MODULE_KEYS]);
    assert.deepEqual(Object.keys(taRu.featuresX.modules), [...MODULE_KEYS]);
  });
});

describe('prefix matching', () => {
  it('matches the prefix itself and paths below it, segment by segment', () => {
    assert.equal(underPrefix('/didox', '/didox'), true);
    assert.equal(underPrefix('/didox/b1/review', '/didox'), true);
    assert.equal(underPrefix('/didox?client=1', '/didox'), true);
    assert.equal(underPrefix('/didoxes', '/didox'), false);
    assert.equal(underPrefix('/api/catalogs/c1/products', '/api/catalogs/*/products'), true);
    assert.equal(underPrefix('/api/catalogs/c1/rows', '/api/catalogs/*/products'), false);
    assert.equal(underPrefix('/api/catalogs//products', '/api/catalogs/*/products'), false);
  });

  it('finds the modules of a path; a catalogue\'s products route belongs to both audit and products', () => {
    assert.deepEqual(modulesOfRoute('/bank/b1/reconcile'), ['bank']);
    assert.deepEqual(modulesOfRoute('/upload'), ['mxik_audit']);
    assert.deepEqual(modulesOfApi('/api/onec/batches'), ['onec']);
    assert.deepEqual(modulesOfApi('/api/catalogs/c1/products'), ['mxik_audit', 'products']);
  });

  it('finds the module of an API path in any letter case, as Express routes it (F20)', () => {
    assert.deepEqual(modulesOfApi('/api/BANK/statements'), ['bank']);
    assert.deepEqual(modulesOfApi('/API/Didox/invoices/i1'), ['didox']);
    assert.deepEqual(modulesOfApi('/api/Catalogs/C1/PRODUCTS'), ['mxik_audit', 'products']);
    for (const key of MODULE_KEYS) {
      for (const prefix of FEATURE_MODULES[key].api) assert.equal(prefix, prefix.toLowerCase(), `${key}: ${prefix} is lower case`);
    }
  });

  it('the strictest state wins: HIDDEN over COMING_SOON over ENABLED', () => {
    const states = { ...allEnabled(), products: 'COMING_SOON' as const };
    assert.deepEqual(strictest(['mxik_audit', 'products'], states), { key: 'products', state: 'COMING_SOON' });
    assert.deepEqual(strictest(['mxik_audit', 'products'], { ...states, mxik_audit: 'HIDDEN' }), { key: 'mxik_audit', state: 'HIDDEN' });
    assert.equal(strictest([], states), null);
  });

  it('a missing row is ENABLED and a row for an unknown key is ignored', () => {
    const states = statesFrom([{ key: 'didox', state: 'HIDDEN' }, { key: 'retired', state: 'HIDDEN' }]);
    assert.deepEqual(states, { ...allEnabled(), didox: 'HIDDEN' });
    assert.ok(!('retired' in states));
  });
});

describe('ttlCache', () => {
  it('reads once per TTL, reads again after it, and after invalidate()', async () => {
    let clock = 0;
    let reads = 0;
    const cache = ttlCache(() => Promise.resolve(++reads), 30_000, () => clock);
    assert.equal(await cache.get(), 1);
    clock = 29_999;
    assert.equal(await cache.get(), 1, 'still fresh');
    clock = 30_000;
    assert.equal(await cache.get(), 2, 'expired');
    cache.invalidate();
    assert.equal(await cache.get(), 3, 'invalidated');
    assert.equal(reads, 3);
  });

  it('shares one read between concurrent callers and does not keep a failure', async () => {
    let reads = 0;
    let fail = true;
    const cache = ttlCache(() => { reads += 1; return fail ? Promise.reject(new Error('down')) : Promise.resolve('up'); }, 30_000, () => 0);
    await Promise.all([assert.rejects(cache.get()), assert.rejects(cache.get())]);
    assert.equal(reads, 1);
    fail = false;
    assert.equal(await cache.get(), 'up');
    assert.equal(reads, 2);
  });
});
