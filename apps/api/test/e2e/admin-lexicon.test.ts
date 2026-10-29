// The admin lexicon endpoints: everyone but a platform admin gets 404 on every method; a platform
// admin lists the lexicon in the contract's shape, adds a synonym entry (refused when it breaks the
// normaliser), disables it, and approves or rejects a global alias candidate.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { aliasKey } from '@tasnivo/domain/lexicon';
import { liveCodes } from '@tasnivo/domain/test-fixtures';
import { dbSkipReason, dropOrgs, makeUser, serverOf, startApp, type TestUser } from '../helpers';
import { CSRF, fits, sessionCookie, withEnv } from '../w2d-support';

const skip = await dbSkipReason();
const e = endpoints.admin;
const NAME = 'Zz-e2e shisha tolali plita 4412';

describe('admin lexicon (e2e)', { skip }, () => {
  let app: INestApplication;
  let platform: TestUser;
  let cookie = '';
  let plainCookie = '';
  let code = '';
  const orgs: string[] = [];
  const entryIds: string[] = [];
  const http = () => request(serverOf(app));
  const asAdmin = <T>(run: () => Promise<T>) => withEnv({ ADMIN_EMAILS: platform.email }, run);

  before(async () => {
    app = await startApp();
    platform = await makeUser();
    const plain = await makeUser();
    const other = await makeUser();
    orgs.push(platform.orgId, plain.orgId, other.orgId);
    await db.user.update({ where: { id: platform.userId }, data: { platformAdmin: true } });
    cookie = await sessionCookie(platform);
    plainCookie = await sessionCookie(plain);
    [code] = await liveCodes(1) as [string];
    await db.lexiconEntry.deleteMany({ where: { key: { contains: 'zz-e2e' } } });
    await db.lexiconEntry.deleteMany({ where: { key: { contains: aliasKey(NAME) } } });
    // Two organisations confirmed the same code for the same name: a candidate.
    for (const orgId of [plain.orgId, other.orgId]) {
      await db.learnedAlias.create({ data: { orgId, key: aliasKey(NAME), label: NAME, code, confirmations: 2 } });
    }
  });
  after(async () => {
    await app.close();
    await db.lexiconEntry.deleteMany({ where: { OR: [{ id: { in: entryIds } }, { key: { contains: 'zz-e2e' } }, { key: { contains: aliasKey(NAME) } }] } });
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('404 without a session, for an ordinary admin, and for a flagged user missing from ADMIN_EMAILS, on every method', async () => {
    const calls = [
      () => http().get('/api/admin/lexicon'),
      () => http().post('/api/admin/lexicon').set(CSRF).send({ kind: 'unit', payload: { alias: 'zz-e2e-x', target: 'dona' } }),
      () => http().patch('/api/admin/lexicon/some-id').set(CSRF).send({ status: 'disabled' }),
      () => http().post('/api/admin/lexicon/aliases').set(CSRF).send({ key: aliasKey(NAME), code, decision: 'approve' }),
    ];
    for (const call of calls) {
      assert.equal((await call()).status, 404);
      assert.equal((await asAdmin(() => call().set('Cookie', plainCookie))).status, 404);
      assert.equal((await withEnv({ ADMIN_EMAILS: 'someone@else.test' }, () => call().set('Cookie', cookie))).status, 404);
    }
    assert.equal((await db.lexiconEntry.count({ where: { key: { contains: 'zz-e2e' } } })), 0, 'nothing was written');
  });

  it('lists the lexicon in the contract\'s shape, with the candidate', async () => {
    const res = await asAdmin(() => http().get('/api/admin/lexicon').set('Cookie', cookie));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const body = fits(e.lexicon.response, res.body);
    assert.ok(body.file.synonyms > 40);
    assert.ok(body.file.units > 40);
    const cand = body.aliases.find((a) => a.key === aliasKey(NAME));
    assert.deepEqual(cand && { code: cand.code, orgs: cand.orgs, confirmations: cand.confirmations, status: cand.status, entryId: cand.entryId }, { code, orgs: 2, confirmations: 4, status: 'candidate', entryId: null });
  });

  it('adds a synonym entry, refuses one that breaks the normaliser, and disables it', async () => {
    const ok = await asAdmin(() => http().post('/api/admin/lexicon').set(CSRF).set('Cookie', cookie)
      .send({ kind: 'synonym', payload: { forms: ['zz-e2e-steklovata'], term: 'стеклянная вата' }, note: 'e2e' }));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const saved = fits(e.createLexiconEntry.response, ok.body);
    assert.equal(saved.ok, true);
    assert.ok(saved.id);
    entryIds.push(saved.id ?? '');
    const bad = fits(e.createLexiconEntry.response, (await asAdmin(() => http().post('/api/admin/lexicon').set(CSRF).set('Cookie', cookie)
      .send({ kind: 'synonym', payload: { forms: ['лист'], term: 'прокат листовой', replace: true } }))).body);
    assert.equal(bad.ok, false);
    assert.ok(bad.problems?.some((p) => p.startsWith('a name without a synonym is unchanged')), JSON.stringify(bad));
    assert.equal((await asAdmin(() => http().post('/api/admin/lexicon').set(CSRF).set('Cookie', cookie).send({ kind: 'nope', payload: {} }))).status, 400);

    const listed = fits(e.lexicon.response, (await asAdmin(() => http().get('/api/admin/lexicon').set('Cookie', cookie))).body);
    assert.equal(listed.synonyms.find((s) => s.id === saved.id)?.status, 'active');
    const off = fits(e.updateLexiconEntry.response, (await asAdmin(() => http().patch(`/api/admin/lexicon/${saved.id}`).set(CSRF).set('Cookie', cookie).send({ status: 'disabled' }))).body);
    assert.equal(off.ok, true);
    const after = fits(e.lexicon.response, (await asAdmin(() => http().get('/api/admin/lexicon').set('Cookie', cookie))).body);
    assert.equal(after.synonyms.find((s) => s.id === saved.id)?.status, 'disabled');
    assert.equal((await asAdmin(() => http().patch('/api/admin/lexicon/no-such-id').set(CSRF).set('Cookie', cookie).send({ status: 'disabled' }))).status, 404);
  });

  it('approves and rejects a global alias candidate', async () => {
    const approve = fits(e.decideAlias.response, (await asAdmin(() => http().post('/api/admin/lexicon/aliases').set(CSRF).set('Cookie', cookie)
      .send({ key: aliasKey(NAME), code, decision: 'approve' }))).body);
    assert.equal(approve.ok, true, JSON.stringify(approve));
    entryIds.push(approve.id ?? '');
    let listed = fits(e.lexicon.response, (await asAdmin(() => http().get('/api/admin/lexicon').set('Cookie', cookie))).body);
    assert.equal(listed.aliases.find((a) => a.key === aliasKey(NAME))?.status, 'active');
    const reject = fits(e.decideAlias.response, (await asAdmin(() => http().post('/api/admin/lexicon/aliases').set(CSRF).set('Cookie', cookie)
      .send({ key: aliasKey(NAME), code, decision: 'reject' }))).body);
    assert.equal(reject.ok, true);
    listed = fits(e.lexicon.response, (await asAdmin(() => http().get('/api/admin/lexicon').set('Cookie', cookie))).body);
    assert.equal(listed.aliases.find((a) => a.key === aliasKey(NAME))?.status, 'rejected');
    const notCandidate = fits(e.decideAlias.response, (await asAdmin(() => http().post('/api/admin/lexicon/aliases').set(CSRF).set('Cookie', cookie)
      .send({ key: 'zz-e2e nobody confirmed', code, decision: 'approve' }))).body);
    assert.equal(notCandidate.ok, false);
    assert.equal((await asAdmin(() => http().post('/api/admin/lexicon/aliases').set(CSRF).set('Cookie', cookie).send({ key: aliasKey(NAME), code: '123', decision: 'approve' }))).status, 400);
  });
});
