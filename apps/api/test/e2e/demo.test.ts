// The demo module against the development database: config, the link request (honeypot, invalid
// input, a real request), peek and open (a fresh demo org and its session cookie, then the
// session works on /api/auth/me), and the lead form with and without a sample file.
import '../setup-env';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { CONTACT_ERROR } from '@tasnivo/domain/lead-guard';
import { dict } from '@tasnivo/i18n/i18n';
import { SESSION_COOKIE } from '../../src/auth-core/session.service';
import { bodyOf, cookiePair, dbSkipReason, dropOrgs, serverOf, setCookies, startApp, testIp } from '../helpers';
import { CSRF, fits, sessionSet, withEnv } from '../w2d-support';

const skip = await dbSkipReason();
const e = endpoints.demo;
const t = dict('uz');
type LeadAnswer = { ok?: true; error?: string; field?: string };
const NO_MAIL = { SMTP_URL: undefined, MAIL_FROM: undefined, NODE_ENV: 'test' };

/** A demo link as requestDemoAccess stores it (only the token's hash), valid for ten minutes. */
async function demoLink(email: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.demoRequest.create({
    data: {
      email, emailKey: email, name: 'Sinov Shaxs', company: 'Sinov MChJ', useCase: 'evaluation',
      tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  return token;
}

describe('demo module (database)', { skip }, () => {
  let app: INestApplication;
  const emails: string[] = [];
  const contacts: string[] = [];
  const demoOrgs: string[] = [];
  const http = () => request(serverOf(app));
  const email = (): string => {
    const address = `e2e${randomBytes(5).toString('hex')}@gmail.com`;
    emails.push(address);
    return address;
  };

  before(async () => { app = await startApp(); });
  after(async () => {
    await app.close();
    await db.demoRequest.deleteMany({ where: { emailKey: { in: emails } } });
    await db.lead.deleteMany({ where: { contact: { in: contacts } } });
    await dropOrgs(demoOrgs);
    await db.$disconnect();
  });

  it('GET /api/demo/config: link and session times', async () => {
    const res = await http().get('/api/demo/config');
    assert.deepEqual(fits(e.config.response, res.body), { linkMinutes: 30, idleMinutes: 30, ttlHours: 24 });
  });

  it('POST /api/demo/request: honeypot, invalid input and a real request answer the form state', async () => {
    const honeypot = await http().post('/api/demo/request').set(CSRF).send({ website: 'bot', email: 'Bot@Spam.test' });
    assert.deepEqual(honeypot.body, { sentTo: 'Bot@Spam.test' });
    const invalid = await http().post('/api/demo/request').set(CSRF).set('X-Real-IP', testIp()).send({ name: '', company: 'X', email: email(), useCase: 'clients' });
    assert.deepEqual(invalid.body, { error: t.demoAccess.errors.invalid });
    const badEmail = await http().post('/api/demo/request').set(CSRF).set('X-Real-IP', testIp()).send({ name: 'A', company: 'B', email: 'not-an-address', useCase: 'clients' });
    assert.deepEqual(badEmail.body, { error: t.demoAccess.errors.email, field: 'email' });
    assert.equal((await http().post('/api/demo/request').send({})).status, 403, 'the CSRF header is required');

    const address = email();
    const ok = await withEnv(NO_MAIL, () => http().post('/api/demo/request').set(CSRF).set('X-Real-IP', testIp()).send({ name: 'Ali Valiyev', company: 'Savdo MChJ', email: address.toUpperCase(), useCase: 'clients' }));
    assert.deepEqual(fits(e.request.response, ok.body), { sentTo: address });
    assert.equal(await db.demoRequest.count({ where: { email: address } }), 1);
  });

  it('GET /api/demo/links/{token}: whose link it is, JSON null for an unknown one', async () => {
    const token = await demoLink(email());
    const peek = await http().get(`/api/demo/links/${token}`);
    assert.deepEqual(peek.body, { name: 'Sinov Shaxs' });
    const unknown = await http().get(`/api/demo/links/${randomBytes(32).toString('base64url')}`);
    assert.equal(unknown.status, 200);
    assert.equal(unknown.text, 'null');
  });

  it('POST /api/demo/open: request → open → a demo session that /api/auth/me accepts; a used link is refused', async () => {
    const token = await demoLink(email());
    const res = await http().post('/api/demo/open').set(CSRF).set('X-Real-IP', testIp()).send({ token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const answer = fits(e.open.response, res.body) as { redirect?: string };
    assert.match(answer.redirect ?? '', /^\/catalogs(\/\w+)?$/);
    const session = await sessionSet(res);
    assert.ok(session?.userId && session.orgId && session.sid);
    assert.equal(session.demo, true);
    demoOrgs.push(session.orgId);
    assert.equal((await db.organization.findUniqueOrThrow({ where: { id: session.orgId } })).kind, 'demo');

    const me = await http().get('/api/auth/me').set('Cookie', cookiePair(setCookies(res), SESSION_COOKIE) ?? '');
    assert.equal(me.status, 200);
    // /api/auth/me answers the CurrentUser itself (contracts auth.me), not { user }.
    assert.equal(bodyOf<{ demo: boolean }>(me).demo, true);

    const again = await http().post('/api/demo/open').set(CSRF).set('X-Real-IP', testIp()).send({ token });
    assert.deepEqual(again.body, { error: t.demoAccess.errors.link });
    assert.deepEqual((await http().post('/api/demo/open').set(CSRF).send({ token: 'short' })).body, { error: t.demoAccess.errors.link });
  });

  it('POST /api/lead without a file stores the contact; a bad contact is the form\'s error', async () => {
    const handle = `@lead${randomBytes(4).toString('hex')}`;
    contacts.push(handle);
    const res = await http().post('/api/lead').set(CSRF).set('X-Real-IP', testIp()).field('contact', handle);
    assert.deepEqual(fits(e.lead.response, res.body), { ok: true });
    assert.equal(await db.lead.count({ where: { contact: handle, filename: null } }), 1);

    const bad = await http().post('/api/lead').set(CSRF).set('X-Real-IP', testIp()).field('contact', '12');
    assert.deepEqual(bad.body, { error: CONTACT_ERROR, field: 'contact', contact: '12' });
    const bot = await http().post('/api/lead').set(CSRF).set('X-Real-IP', testIp()).field('contact', 'x').field('website', 'spam');
    assert.deepEqual(bot.body, { ok: true });
  });

  it('POST /api/lead with a sample: stored with its row count; too big or the wrong type is refused on the file field', async () => {
    const handle = `@lead${randomBytes(4).toString('hex')}`;
    contacts.push(handle);
    const csv = Buffer.from('Nomi;Birlik\nGuruch;kg\nShakar;kg\n');
    const res = await http().post('/api/lead').set(CSRF).set('X-Real-IP', testIp()).field('contact', handle).attach('file', csv, 'namuna.csv');
    assert.deepEqual(res.body, { ok: true });
    const lead = await db.lead.findFirstOrThrow({ where: { contact: handle } });
    assert.equal(lead.filename, 'namuna.csv');
    assert.equal(lead.fileBytes, csv.length);
    assert.equal(lead.rowGuess, 2);

    const big = await http().post('/api/lead').set(CSRF).set('X-Real-IP', testIp()).field('contact', handle).attach('file', Buffer.alloc(5 * 1024 * 1024 + 1, 65), 'katta.csv');
    assert.deepEqual(big.body, { error: 'Fayl juda katta (5 MB dan oshmasligi kerak).', field: 'file', contact: handle });
    const pdf = await http().post('/api/lead').set(CSRF).set('X-Real-IP', testIp()).field('contact', handle).attach('file', Buffer.from('%PDF'), 'hujjat.pdf');
    assert.equal(bodyOf<LeadAnswer>(pdf).field, 'file');
  });

  it('POST /api/lead: five per address per ten minutes, then the wait in minutes', async () => {
    const ip = testIp();
    for (let i = 0; i < 5; i++) await http().post('/api/lead').set(CSRF).set('X-Real-IP', ip).field('contact', '1');
    const sixth = await http().post('/api/lead').set(CSRF).set('X-Real-IP', ip).field('contact', '1');
    assert.match(bodyOf<LeadAnswer>(sixth).error ?? '', /^Soʻrovlar juda koʻp\. \d+ daqiqadan keyin/);
  });
});
