// Q9: the first-party Swagger (every internal route, admin and cron included) is not served by a
// production API unless API_DOCS_PUBLIC=1; the public API's own contract stays at /api/v1/openapi.json.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { db } from '@tasnivo/db';
import { apiDocsEnabled } from '../../src/app';
import { serverOf, startApp } from '../helpers';

describe('/api/docs exposure (Q9)', () => {
  const apps: INestApplication[] = [];
  after(async () => {
    for (const app of apps) await app.close();
    await db.$disconnect();
  });

  it('apiDocsEnabled: on outside production, off in production unless API_DOCS_PUBLIC=1', () => {
    assert.equal(apiDocsEnabled({}), true);
    assert.equal(apiDocsEnabled({ NODE_ENV: 'development' }), true);
    assert.equal(apiDocsEnabled({ NODE_ENV: 'production' }), false);
    assert.equal(apiDocsEnabled({ NODE_ENV: 'production', API_DOCS_PUBLIC: '1' }), true);
    assert.equal(apiDocsEnabled({ NODE_ENV: 'production', API_DOCS_PUBLIC: 'yes' }), false);
  });

  it('a production app answers 404 on /api/docs and /api/docs-json; /api/v1/openapi.json still answers', async () => {
    const app = await startApp({ docs: false });
    apps.push(app);
    const http = () => request(serverOf(app));
    assert.equal((await http().get('/api/docs')).status, 404);
    assert.equal((await http().get('/api/docs-json')).status, 404);
    const open = await http().get('/api/v1/openapi.json');
    assert.equal(open.status, 200);
    assert.ok((open.body as { paths?: object }).paths);
  });

  it('a development app serves the Swagger document', async () => {
    const app = await startApp({ docs: true });
    apps.push(app);
    const res = await request(serverOf(app)).get('/api/docs-json');
    assert.equal(res.status, 200);
    assert.ok(Object.keys((res.body as { paths: object }).paths).length > 100);
  });
});
