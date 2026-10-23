// Q5: with no trusted proxy (TRUST_PROXY=0, or unset in production) the per-address rate limits key
// on the socket address, so a client that reaches the API around the proxy cannot pick a fresh
// bucket by sending its own X-Real-IP.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import { db } from '@tasnivo/db';
import { clearAttempts, RULES } from '@tasnivo/domain/security/rate-limit';
import { i18nFor } from '@tasnivo/i18n/locale';
import { clientIp } from '../../src/http/request';
import { bodyOf, dbSkipReason, fakeReq, startApp, testIp } from '../helpers';
import { client } from '../session-helpers';

const skip = await dbSkipReason();
const restore = (value: string | undefined): void => {
  if (value === undefined) delete process.env['TRUST_PROXY'];
  else process.env['TRUST_PROXY'] = value;
};
const { ta } = i18nFor('uz');
// What supertest's loopback socket can look like to the API.
const LOOPBACK = ['::ffff:127.0.0.1', '127.0.0.1', '::1'];

describe('client address without a trusted proxy (Q5)', () => {
  it('request.clientIp ignores X-Real-IP / X-Forwarded-For when no proxy is trusted', () => {
    const saved = process.env['TRUST_PROXY'];
    try {
      const req = { ...fakeReq({ headers: { 'x-real-ip': '10.77.1.2', 'x-forwarded-for': '10.77.1.3' } }), socket: { remoteAddress: '203.0.113.5' } } as unknown as Request;
      process.env['TRUST_PROXY'] = '0';
      assert.equal(clientIp(req), '203.0.113.5');
      process.env['TRUST_PROXY'] = '1';
      assert.equal(clientIp(req), '10.77.1.2');
    } finally {
      restore(saved);
    }
  });
});

describe('a spoofed X-Real-IP does not reset the per-address bucket (Q5, database)', { skip }, () => {
  let app: INestApplication;
  let call: ReturnType<typeof client>;
  const saved = process.env['TRUST_PROXY'];
  const clear = () => Promise.all(LOOPBACK.map((ip) => clearAttempts(RULES.signupIp, ip)));

  before(async () => {
    process.env['TRUST_PROXY'] = '0';
    await clear();
    app = await startApp();
    call = client(app);
  });
  after(async () => {
    await clear();
    restore(saved);
    await app.close();
    await db.$disconnect();
  });

  it('sign-up from one socket is limited after 8 even with a new X-Real-IP on every request', async () => {
    const body = { email: 'bad', password: 'x', firm: 'x' };
    for (let i = 0; i < RULES.signupIp.limit; i++) {
      assert.deepEqual(bodyOf<{ error?: string }>(await call(undefined, testIp()).post('/api/auth/sign-up').send(body)), { error: ta.msg.account.emailBad });
    }
    const limited = bodyOf<{ error?: string }>(await call(undefined, testIp()).post('/api/auth/sign-up').send(body));
    assert.notEqual(limited.error, ta.msg.account.emailBad);
    assert.match(limited.error ?? '', /\d/);
  });
});
