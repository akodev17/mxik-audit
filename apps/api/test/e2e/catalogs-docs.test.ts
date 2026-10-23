// Every operation of endpoints.catalogs, endpoints.imports and endpoints.share is a route of the
// real app, documented in /api/docs-json under its operation id. Needs no database (nothing is queried).
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints, expressPath, type Endpoint } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { serverOf, startApp } from '../helpers';

type Doc = { paths: Record<string, Record<string, { operationId?: string; 'x-role'?: string; parameters?: { name: string; in: string }[] }>> };

const mine: Endpoint[] = [endpoints.catalogs, endpoints.imports, endpoints.share].flatMap((m) => Object.values(m) as Endpoint[]);

describe('catalogs / imports / share routes in Swagger', () => {
  let app: INestApplication;
  let doc: Doc;

  before(async () => {
    app = await startApp();
    doc = (await request(serverOf(app)).get('/api/docs-json')).body as Doc;
  });
  after(async () => {
    await app.close();
    await db.$disconnect();
  });

  it('documents all 40 operations with the registry\'s method, path, operation id and role', () => {
    assert.equal(mine.length, 40);
    for (const e of mine) {
      const op = doc.paths[e.path]?.[e.method.toLowerCase()];
      assert.ok(op, `${e.method} ${e.path} is missing`);
      assert.equal(op.operationId, e.operationId);
      if (e.role) assert.equal(op['x-role'], e.role);
      if (e.csrf) assert.ok(op.parameters?.some((p) => p.in === 'header' && p.name === 'X-Requested-With'), `${e.operationId}: CSRF header`);
    }
  });

  it('every session GET route answers 401 without a cookie (before any query)', async () => {
    const server = serverOf(app);
    for (const e of mine.filter((x) => x.auth === 'session' && x.method === 'GET')) {
      const path = expressPath(e.path).replace(/:(\w+)/g, 'x');
      assert.equal((await request(server).get(path)).status, 401, path);
    }
  });
});
