// The dashboard's value measures through the real app (S9, F10/F19/D8): the per-client results
// download is scoped like the dashboard, the minutes per decision are an admin's setting that the
// dashboard multiplies, and hiding the checklist is saved per person.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { makeClient, makeClientCatalog } from '@tasnivo/domain/firm-test-fixtures';
import { dbSkipReason, dropOrgs } from '@tasnivo/domain/test-fixtures';
import { bodyOf, serverOf, startApp } from '../helpers';
import { as, member, orgWithAdmin, shaped, type Member } from './workspace-fixtures';

const skip = await dbSkipReason();

type Value = { minutesPerDecision: number; minutesSaved: number; decisions: number; rowsChecked: number; clients: { name: string }[] };
type Dash = { value: Value; checklist: { open: boolean; hidden: boolean }; onboarding: { key: string; optional: boolean }[] };

/** A supertest response body read as text (CSV arrives as a Buffer or a string). */
const text = (res: { text?: string; body: unknown }): string => (Buffer.isBuffer(res.body) ? res.body.toString('utf8') : res.text ?? '');

describe('value measures and the results download (e2e)', { skip }, () => {
  let app: INestApplication;
  const orgs: string[] = [];
  let admin: Member;
  let scoped: Member;
  let viewer: Member;
  let stranger: Member;
  let demo: Member;
  const http = () => request(serverOf(app));
  const get = (path: string, who: Member) => as(http().get(path), who, false);
  const put = (path: string, who: Member, body: object) => as(http().put(path), who).send(body);
  const dash = async (who: Member): Promise<Dash> => {
    const res = await get('/api/dashboard', who);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return shaped(endpoints.workspace.dashboard, res.body) as Dash;
  };

  before(async () => {
    app = await startApp();
    admin = await orgWithAdmin(orgs);
    stranger = await orgWithAdmin(orgs);
    demo = await orgWithAdmin(orgs, 'demo');
    const alfa = await makeClient(admin.orgId, 'Alfa savdo');
    const beta = await makeClient(admin.orgId, 'Beta servis');
    scoped = await member(admin.orgId, 'accountant', [beta]);
    viewer = await member(admin.orgId, 'viewer', [alfa]);
    await makeClientCatalog(admin.orgId, alfa, [
      { name: 'Guruch', findings: [{ severity: 'high', decision: 'accepted' }] },
      { name: 'Shakar', findings: [{ severity: 'high', decision: 'rejected' }] },
    ]);
    await makeClientCatalog(admin.orgId, beta, [{ name: 'Yog', findings: [{ severity: 'high', decision: 'accepted' }] }]);
    await makeClientCatalog(stranger.orgId, await makeClient(stranger.orgId, 'Begona firma'), [{ name: 'Un', findings: [{ severity: 'high', decision: 'accepted' }] }]);
  });

  after(async () => {
    await app?.close();
    await dropOrgs(orgs);
  });

  it('the download needs a session and lists only the clients the member may see', async () => {
    assert.equal((await http().get('/api/dashboard/results?format=csv')).status, 401);

    const all = await get('/api/dashboard/results?format=csv', admin).buffer(true);
    assert.equal(all.status, 200);
    assert.match(String(all.headers['content-type']), /^text\/csv/);
    assert.match(String(all.headers['content-disposition']), /^attachment;/);
    const csv = text(all);
    assert.match(csv, /Alfa savdo,1,2,0,2,2,2,/);
    assert.match(csv, /Beta servis,1,1,0,1,1,1,/);
    assert.doesNotMatch(csv, /Begona/);

    const mine = text(await get('/api/dashboard/results?format=csv', scoped).buffer(true));
    assert.match(mine, /Beta servis/);
    assert.doesNotMatch(mine, /Alfa savdo|Begona/);
    const viewers = text(await get('/api/dashboard/results?format=csv', viewer).buffer(true));
    assert.match(viewers, /Alfa savdo/);
    assert.doesNotMatch(viewers, /Beta servis/);
    // Another org's admin gets their own clients only, whatever accountant id they pass.
    const theirs = text(await get(`/api/dashboard/results?format=csv&accountant=${scoped.userId}`, stranger).buffer(true));
    assert.match(theirs, /Begona firma/);
    assert.doesNotMatch(theirs, /Alfa savdo|Beta servis/);
    // The admin's accountant filter narrows to that accountant's clients.
    const filtered = text(await get(`/api/dashboard/results?format=csv&accountant=${scoped.userId}`, admin).buffer(true));
    assert.match(filtered, /Beta servis/);
    assert.doesNotMatch(filtered, /Alfa savdo/);

    const xlsx = await get('/api/dashboard/results', admin).buffer(true);
    assert.equal(xlsx.status, 200);
    assert.equal(xlsx.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal((await get('/api/dashboard/results?format=pdf', admin)).status, 400);
  });

  it('minutes per decision: an admin\'s setting, bounded, refused to an accountant and a demo; the dashboard multiplies it', async () => {
    const before = await dash(admin);
    assert.equal(before.value.minutesPerDecision, 3);
    assert.equal(before.value.decisions, 3);
    assert.equal(before.value.minutesSaved, 9);

    const refused = await put('/api/account/minutes-per-decision', scoped, { minutes: 10 });
    assert.equal(refused.status, 403);
    assert.equal(bodyOf(refused).error.code, 'forbidden');
    assert.equal((await put('/api/account/minutes-per-decision', viewer, { minutes: 10 })).status, 403);
    const demoRefused = await put('/api/account/minutes-per-decision', demo, { minutes: 10 });
    assert.equal(demoRefused.status, 403);
    assert.equal(bodyOf(demoRefused).error.code, 'demo');
    for (const minutes of [0, 61, 2.5]) assert.equal((await put('/api/account/minutes-per-decision', admin, { minutes })).status, 400, String(minutes));

    const saved = await put('/api/account/minutes-per-decision', admin, { minutes: 7 });
    assert.equal(saved.status, 200);
    assert.equal(saved.body, true);
    const account = shaped(endpoints.account.get, (await get('/api/account', admin)).body) as { minutesPerDecision: number };
    assert.equal(account.minutesPerDecision, 7);
    const after = await dash(admin);
    assert.equal(after.value.minutesPerDecision, 7);
    assert.equal(after.value.minutesSaved, 21);
    // The scoped accountant's measures use the same setting over their own client only.
    const theirs = await dash(scoped);
    assert.deepEqual(theirs.value.clients.map((c) => c.name), ['Beta servis']);
    assert.equal(theirs.value.minutesSaved, 7);
    const org = await db.organization.findUniqueOrThrow({ where: { id: admin.orgId }, select: { minutesPerDecision: true } });
    assert.equal(org.minutesPerDecision, 7);
  });

  it('the checklist: optional steps flagged, hidden per person through the API', async () => {
    const first = await dash(admin);
    assert.equal(first.checklist.hidden, false);
    assert.ok(first.onboarding.some((s) => s.key === 'export' && !s.optional));
    assert.ok(first.onboarding.some((s) => s.key === 'twoFactor' && s.optional));

    assert.equal((await put('/api/account/onboarding', admin, { hidden: true })).status, 200);
    assert.equal((await dash(admin)).checklist.hidden, true);
    assert.equal((await dash(scoped)).checklist.hidden, false, 'another person is not affected');
    assert.equal((await put('/api/account/onboarding', admin, { hidden: false })).status, 200);
    assert.equal((await dash(admin)).checklist.hidden, false);
    assert.equal((await put('/api/account/onboarding', admin, { hidden: 'yes' })).status, 400);
  });
});
