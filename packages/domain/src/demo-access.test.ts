// Demo access by e-mail, against the dev database (skips when it is not there). Mail is switched off, so a
// request hands back its link instead of sending it.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { demoExportRefused } from './catalog-exports.js';
import { claimDemoAccess, peekDemoLink, purgeDemoRequests, requestDemoAccess, type DemoMail } from './demo-access.js';
import { isDemoOrg } from './demo.js';
import { attemptKey } from './security/rate-limit.js';
import { createRecord, recordAccepted } from './security/session-store.js';
import { dbSkipReason, dropOrgs, liveCodes, makeCatalog, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();
const tag = (): string => randomBytes(4).toString('hex');
const mail: DemoMail = { subject: 's', body: (link) => link };
const tokenOf = (link: string | null): string => (link ?? '').split('/').pop() ?? '';

describe('demo access (database)', { skip }, () => {
  let template: TestActor;
  let customer: TestActor;
  const demoOrgs: string[] = [];
  const keys: string[] = [];
  const savedSmtp = process.env['SMTP_URL'];

  const person = (over: Partial<{ name: string; company: string; email: string; useCase: string }> = {}) =>
    ({ name: 'Ali Valiyev', company: 'Acme MChJ', email: `ali-${tag()}@acme-${tag()}.example`, useCase: 'evaluation', ...over });
  const ip = (): string => { const k = `test-ip-${tag()}`; keys.push(k); return k; };
  const ask = (input = person(), address = ip()) => requestDemoAccess(input, { ip: address, mail });

  before(async () => {
    delete process.env['SMTP_URL'];
    const code = (await liveCodes(1))[0] ?? null;
    template = await makeOrg('demo_template');
    await makeCatalog(template.orgId, [{ rawName: 'Demo guruch', suggestedMxik: code, confidence: 0.9 }]);
    customer = await makeOrg('customer');
    await makeCatalog(customer.orgId, [{ rawName: 'Real customer row', suggestedMxik: code, confidence: 0.8 }]);
  });
  after(async () => {
    if (savedSmtp !== undefined) process.env['SMTP_URL'] = savedSmtp;
    await dropOrgs([template.orgId, customer.orgId, ...demoOrgs]);
    await db.demoRequest.deleteMany({ where: { email: { endsWith: '.example' } } });
    await db.authAttempt.deleteMany({ where: { key: { in: keys.map(attemptKey) } } });
    await db.$disconnect();
  });

  it('refuses incomplete, malformed and throwaway requests and stores nothing for them', async () => {
    const before = await db.demoRequest.count();
    assert.deepEqual(await ask(person({ name: '  ' })), { ok: false, error: 'invalid' });
    assert.deepEqual(await ask(person({ company: 'x'.repeat(151) })), { ok: false, error: 'invalid' });
    assert.deepEqual(await ask(person({ useCase: 'hacking' })), { ok: false, error: 'invalid' });
    assert.deepEqual(await ask(person({ email: 'nope' })), { ok: false, error: 'email' });
    assert.deepEqual(await ask(person({ email: `x-${tag()}@mailinator.com` })), { ok: false, error: 'disposable' });
    assert.equal(await db.demoRequest.count(), before);
  });

  it('stores only a hash of the link, which works once and then never again', async () => {
    const input = person();
    const result = await ask(input);
    assert.ok(result.ok && result.link);
    const token = tokenOf(result.link);
    assert.ok(token.length >= 40);
    const rows = await db.demoRequest.findMany({ where: { email: input.email } });
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0]?.tokenHash, token);
    assert.ok(!JSON.stringify(rows).includes(token), 'the token itself is stored nowhere');

    assert.deepEqual(await peekDemoLink(token), { name: 'Ali Valiyev' });
    assert.deepEqual(await peekDemoLink(token), { name: 'Ali Valiyev' }, 'looking at the page uses nothing up');
    const claim = await claimDemoAccess(token);
    assert.ok(claim.ok);
    demoOrgs.push(claim.session.orgId);
    assert.ok(await isDemoOrg(claim.session.orgId));
    assert.equal(await peekDemoLink(token), null);
    assert.deepEqual(await claimDemoAccess(token), { ok: false, error: 'invalid' });
    assert.equal((await db.demoRequest.findFirstOrThrow({ where: { email: input.email } })).orgId, claim.session.orgId);
  });

  it('two clicks at once open one demo', async () => {
    const result = await ask();
    assert.ok(result.ok && result.link);
    const token = tokenOf(result.link);
    const both = await Promise.all([claimDemoAccess(token), claimDemoAccess(token)]);
    assert.equal(both.filter((c) => c.ok).length, 1);
    for (const c of both) if (c.ok) demoOrgs.push(c.session.orgId);
  });

  it('a link expires, a wrong token never works, and a newer link replaces the older one', async () => {
    const input = person();
    const first = await ask(input);
    assert.ok(first.ok && first.link);
    const later = new Date(Date.now() + 31 * 60_000);
    assert.deepEqual(await claimDemoAccess(tokenOf(first.link), later), { ok: false, error: 'invalid' }, 'older than DEMO_LINK_MINUTES');
    assert.equal(await peekDemoLink(tokenOf(first.link), later), null);
    assert.deepEqual(await claimDemoAccess('x'.repeat(43)), { ok: false, error: 'invalid' });

    const second = await ask(input);
    const third = await ask(input);
    assert.ok(second.ok && third.ok && second.link && third.link);
    assert.equal(await peekDemoLink(tokenOf(second.link)), null, 'the earlier unused link stopped working');
    assert.ok(await peekDemoLink(tokenOf(third.link)));
  });

  it('limits requests per address and per mailbox, however the address is written', async () => {
    const address = ip();
    for (let i = 0; i < 5; i++) assert.equal((await ask(person(), address)).ok, true, `request ${i + 1}`);
    assert.deepEqual(await ask(person(), address), { ok: false, error: 'rate' });

    const local = `limit${tag()}`;
    const results = [];
    for (const variant of [`${local}@gmail.com`, `${local}+a@gmail.com`, `${local.slice(0, 2)}.${local.slice(2)}@googlemail.com`, `${local}+b@gmail.com`]) {
      results.push(await ask(person({ email: variant })));
    }
    assert.deepEqual(results.map((r) => r.ok), [true, true, true, false], 'the fourth alias of one mailbox within an hour is refused');
    await db.demoRequest.deleteMany({ where: { email: { contains: local } } });
  });

  it('opens at most three demos a day for one mailbox', async () => {
    const local = `cap${tag()}`;
    const email = (n: number): string => `${local}+${n}@acme-cap.example`;
    for (let n = 1; n <= 3; n++) {
      const result = await ask(person({ email: email(n) }));
      assert.ok(result.ok && result.link);
      const claim = await claimDemoAccess(tokenOf(result.link));
      assert.ok(claim.ok, `demo ${n}`);
      demoOrgs.push(claim.session.orgId);
      // The hourly request limit is a different guard; clear it so this test reaches the daily one.
      await db.authAttempt.deleteMany({ where: { kind: 'demo_req_email' } });
    }
    assert.deepEqual(await ask(person({ email: email(4) })), { ok: false, error: 'limit' });
  });

  it('a demo ends after its idle time and without a session record it never starts', async () => {
    const requested = await ask();
    assert.ok(requested.ok && requested.link);
    const opened = await claimDemoAccess(tokenOf(requested.link));
    assert.ok(opened.ok);
    demoOrgs.push(opened.session.orgId);
    const { userId, orgId } = opened.session;
    assert.equal(await recordAccepted(undefined, userId, true), false, 'a demo cookie without a server-side record is refused');
    const sid = await createRecord(userId, orgId, 'test');
    assert.equal(await recordAccepted(sid, userId, true), true);
    await db.userSession.update({ where: { id: sid }, data: { lastSeenAt: new Date(Date.now() - 29 * 60_000) } });
    assert.equal(await recordAccepted(sid, userId, true), true, '29 minutes idle is still inside the limit');
    await db.userSession.update({ where: { id: sid }, data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    assert.equal(await recordAccepted(sid, userId, true), false, '31 minutes idle ends the demo');
    assert.equal(await recordAccepted(sid, userId, false), true, 'a normal account keeps its week');
  });

  it('a demo has a fixed end set when it opens', async () => {
    const requested = await ask();
    assert.ok(requested.ok && requested.link);
    const opened = await claimDemoAccess(tokenOf(requested.link));
    assert.ok(opened.ok);
    demoOrgs.push(opened.session.orgId);
    const org = await db.organization.findUniqueOrThrow({ where: { id: opened.session.orgId }, select: { kind: true, expiresAt: true } });
    assert.equal(org.kind, 'demo');
    const hours = ((org.expiresAt?.getTime() ?? 0) - Date.now()) / 3_600_000;
    assert.ok(hours > 23.9 && hours <= 24, `ends in about 24 hours (${hours.toFixed(2)})`);
  });

  it('caps the downloads of a demo and leaves other orgs alone', async () => {
    const requested = await ask();
    assert.ok(requested.ok && requested.link);
    const opened = await claimDemoAccess(tokenOf(requested.link));
    assert.ok(opened.ok);
    demoOrgs.push(opened.session.orgId);
    process.env['DEMO_MAX_EXPORTS'] = '2';
    try {
      assert.equal(await demoExportRefused(opened.session.orgId), false);
      assert.equal(await demoExportRefused(opened.session.orgId), false);
      assert.equal(await demoExportRefused(opened.session.orgId), true, 'the third download is refused (the API answers 429)');
      for (let i = 0; i < 5; i++) assert.equal(await demoExportRefused(customer.orgId), false, 'a real org is never limited by the demo cap');
    } finally {
      delete process.env['DEMO_MAX_EXPORTS'];
      await db.authAttempt.deleteMany({ where: { key: attemptKey(opened.session.orgId) } });
    }
  });

  it('deletes old requests and keeps recent ones', async () => {
    const old = await db.demoRequest.create({ data: { email: `old-${tag()}@acme.example`, emailKey: 'old', name: 'n', company: 'c', useCase: 'other', tokenHash: tag() + tag(), expiresAt: new Date(), createdAt: new Date(Date.now() - 100 * 86_400_000) } });
    const fresh = await db.demoRequest.create({ data: { email: `new-${tag()}@acme.example`, emailKey: 'new', name: 'n', company: 'c', useCase: 'other', tokenHash: tag() + tag(), expiresAt: new Date() } });
    await purgeDemoRequests(new Date(), 90);
    assert.equal(await db.demoRequest.count({ where: { id: old.id } }), 0);
    assert.equal(await db.demoRequest.count({ where: { id: fresh.id } }), 1);
  });
});
