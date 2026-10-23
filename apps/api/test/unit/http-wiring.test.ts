// Cross-cutting HTTP wiring of the whole app: request body limits against the registry's caps.
// Builds the app in memory; no database needed (every request here is refused before a query).
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { serverOf, startApp } from '../helpers';

describe('request bodies', () => {
  let app: INestApplication;
  before(async () => { app = await startApp(); });
  after(() => app.close());

  it('takes a group decision of 5 000 ids (the contract\'s cap), about 140 KB of JSON', async () => {
    const findingIds = Array.from({ length: 5000 }, (_, i) => `cm${String(i).padStart(23, '0')}`);
    const res = await request(serverOf(app)).post('/api/decisions/group').set('X-Requested-With', 'tasnivo')
      .send({ findingIds, decision: 'accepted' });
    // Parsed, then refused for want of a session: not 413, and never a 500.
    assert.equal(res.status, 401);
  });

  it('refuses a body over 1 MB with 413 too_large in the error envelope', async () => {
    const res = await request(serverOf(app)).post('/api/auth/sign-in').set('X-Requested-With', 'tasnivo')
      .send({ email: 'a'.repeat(1_100_000), password: 'x' });
    assert.equal(res.status, 413);
    assert.equal((res.body as { error: { code: string } }).error.code, 'too_large');
  });
});
