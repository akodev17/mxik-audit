// Every operation of the workspace, dictionary, reminders and notifications modules is served and
// documented in /api/docs-json under its registry method, path and operation id. Needs no database.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints, type Endpoint } from '@tasnivo/contracts';
import { serverOf, startApp } from '../helpers';

type Doc = { paths: Record<string, Record<string, { operationId?: string; parameters?: { name: string; in: string }[] }>> };

const MODULES = ['workspace', 'dictionary', 'reminders', 'notifications'] as const;
const ours: Endpoint[] = MODULES.flatMap((m) => Object.values(endpoints[m] as Record<string, Endpoint>));

describe('workspace, dictionary, reminders, notifications in Swagger', () => {
  let app: INestApplication;
  before(async () => { app = await startApp(); });
  after(async () => { await app?.close(); });

  it('each registry operation has its route, operation id and path parameters', async () => {
    const doc = (await request(serverOf(app)).get('/api/docs-json')).body as Doc;
    for (const e of ours) {
      const op = doc.paths[e.path]?.[e.method.toLowerCase()];
      assert.ok(op, `${e.operationId}: ${e.method} ${e.path} missing`);
      assert.equal(op.operationId, e.operationId);
      const inPath = (op.parameters ?? []).filter((p) => p.in === 'path').map((p) => p.name).sort();
      const declared = Object.keys((e.params?.shape ?? {}) as Record<string, unknown>).sort();
      assert.deepEqual(inPath, declared, e.operationId);
    }
    // 44, plus S9: the dashboard's per-client results download (workspace.dashboardResults).
    assert.equal(ours.length, 45);
  });

  it('a session route without a cookie is 401 before anything else', async () => {
    for (const e of ours.filter((x) => x.method === 'GET' && !x.params)) {
      const res = await request(serverOf(app)).get(e.path);
      assert.equal(res.status, 401, e.operationId);
    }
  });
});
