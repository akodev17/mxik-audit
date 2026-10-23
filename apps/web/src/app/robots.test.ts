import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import robots, { PRIVATE_PATHS } from './robots';

describe('robots.txt', () => {
  it('B16: allows the public pages, keeps every signed-in section out and points at the sitemap', () => {
    const saved = process.env['APP_URL'];
    process.env['APP_URL'] = 'https://tasnivo.uz/';
    try {
      const r = robots();
      assert.equal(r.sitemap, 'https://tasnivo.uz/sitemap.xml');
      const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
      assert.equal(rule?.allow, '/');
      for (const path of ['/dashboard', '/catalogs', '/clients', '/settings', '/r/', '/invite/', '/reset/', '/demo/verify/']) {
        assert.ok((rule?.disallow as string[]).includes(path), path);
      }
    } finally {
      if (saved === undefined) delete process.env['APP_URL'];
      else process.env['APP_URL'] = saved;
    }
  });

  it('B16: every section of the signed-in app is disallowed', () => {
    const sections = readdirSync(join('apps', 'web', 'src', 'app', '(app)'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => `/${d.name}`);
    for (const section of sections) assert.ok((PRIVATE_PATHS as readonly string[]).includes(section), section);
  });
});
