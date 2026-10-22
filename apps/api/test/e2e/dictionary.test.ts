// The dictionary module through the real app: the page's list (compared with the domain read the
// web page makes), the accept-all button on a catalogue, edits, deletes and the auto-accept setting;
// refusals for a viewer, an accountant on the admin setting, another org and a scoped member.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { dictionaryPage } from '@tasnivo/domain/dictionary-ops';
import { makeClient } from '@tasnivo/domain/firm-test-fixtures';
import { dbSkipReason, dropOrgs, liveCodes, makeCatalog } from '@tasnivo/domain/test-fixtures';
import { i18nFor } from '@tasnivo/i18n/locale';
import { bodyOf, serverOf, startApp } from '../helpers';
import { as, member, orgWithAdmin, shaped, type Member } from './workspace-fixtures';

const skip = await dbSkipReason();
const d = endpoints.dictionary;

type Ok = { ok: boolean };

describe('dictionary module (e2e)', { skip }, () => {
  let app: INestApplication;
  const orgs: string[] = [];
  let admin: Member;
  let accountant: Member;
  let viewer: Member;
  let scoped: Member;
  let stranger: Member;
  let codes: string[];
  const entries: string[] = [];
  const http = () => request(serverOf(app));
  const get = (path: string, who: Member) => as(http().get(path), who, false);

  before(async () => {
    app = await startApp();
    admin = await orgWithAdmin(orgs);
    accountant = await member(admin.orgId, 'accountant');
    viewer = await member(admin.orgId, 'viewer');
    scoped = await member(admin.orgId, 'accountant', [await makeClient(admin.orgId, 'Scoped client')]);
    stranger = await orgWithAdmin(orgs);
    codes = await liveCodes(3);
    for (const [i, label] of ['sut 1l', 'non bugdoy', 'shakar 1kg'].entries()) {
      const row = await db.firmMapping.create({
        data: { orgId: admin.orgId, kind: 'name', key: `${label}|test`, label, code: codes[i]!, uses: 10 - i, confirmations: i, source: 'manual', createdBy: admin.userId },
      });
      entries.push(row.id);
    }
  });

  after(async () => {
    await app?.close();
    await dropOrgs(orgs);
  });

  it('list: the page\'s rows, counts and paging, as the domain read the page makes', async () => {
    const res = await get('/api/dictionary?q=sut&f=all&page=0', viewer);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const body = shaped(d.list, res.body) as { rows: { label: string }[]; total: number; available: boolean };
    const page = await dictionaryPage(viewer, { q: 'sut', f: 'all', page: 0 }, 'uz');
    assert.deepEqual(res.body, JSON.parse(JSON.stringify({ rows: page.rows, counts: page.counts, total: page.total, pageSize: page.pageSize, available: true })));
    assert.deepEqual(body.rows.map((r) => r.label), ['sut 1l']);
    const all = shaped(d.list, (await get('/api/dictionary', viewer)).body) as { rows: { label: string }[] };
    assert.deepEqual(all.rows.map((r) => r.label), ['sut 1l', 'non bugdoy', 'shakar 1kg'], 'most used first');
    assert.equal((await get('/api/dictionary?page=-1', viewer)).status, 400);
  });

  it('list: a member scoped to some clients sees no dictionary; another org sees its own (empty)', async () => {
    const res = shaped(d.list, (await get('/api/dictionary', scoped)).body) as { available: boolean; rows: unknown[] };
    assert.equal(res.available, false);
    assert.deepEqual(res.rows, []);
    assert.equal((shaped(d.list, (await get('/api/dictionary', stranger)).body) as { total: number }).total, 0);
  });

  it('update: a bad code answers the form message; a live code is one confirmation', async () => {
    const t = i18nFor('uz');
    const bad = await as(http().patch(`/api/dictionary/${entries[0]}`), accountant).send({ code: '123' });
    assert.deepEqual(bad.body, { ok: false, error: t.ta.wsX.dict.codeFormat });
    const missing = await as(http().patch(`/api/dictionary/${entries[0]}`), accountant).send({ code: '99999999999999999' });
    assert.deepEqual(missing.body, { ok: false, error: t.ta.msg.codeNotInClassifier });
    const ok = await as(http().patch(`/api/dictionary/${entries[0]}`), accountant).send({ code: codes[2] });
    assert.deepEqual(shaped(d.update, ok.body), { ok: true });
    const row = await db.firmMapping.findUniqueOrThrow({ where: { id: entries[0]! } });
    assert.equal(row.code, codes[2]);
    assert.equal(row.confirmations, 1);
    assert.equal(row.source, 'edit');
    const foreign = await as(http().patch(`/api/dictionary/${entries[0]}`), stranger).send({ code: codes[1] });
    assert.deepEqual(foreign.body, { ok: false, error: t.t.errorGeneric });
    assert.equal((await as(http().patch(`/api/dictionary/${entries[0]}`), viewer).send({ code: codes[1] })).status, 403);
  });

  it('remove: deletes for the org, refuses another org and a viewer', async () => {
    assert.equal((await as(http().delete(`/api/dictionary/${entries[2]}`), viewer)).status, 403);
    assert.equal(bodyOf<Ok>(await as(http().delete(`/api/dictionary/${entries[2]}`), stranger)).ok, false);
    assert.deepEqual((await as(http().delete(`/api/dictionary/${entries[2]}`), accountant)).body, { ok: true });
    assert.equal(await db.firmMapping.count({ where: { id: entries[2]! } }), 0);
  });

  it('auto-accept: admins only, recorded in the audit log', async () => {
    const refused = await as(http().put('/api/dictionary/auto-accept'), accountant).send({ on: true });
    assert.equal(refused.status, 403);
    assert.deepEqual((await as(http().put('/api/dictionary/auto-accept'), admin).send({ on: true })).body, { ok: true });
    assert.equal((await db.organization.findUniqueOrThrow({ where: { id: admin.orgId } })).dictAutoAccept, true);
    assert.equal(await db.auditEvent.count({ where: { orgId: admin.orgId, action: 'dictionary.auto_accept' } }), 1);
    assert.equal((await as(http().put('/api/dictionary/auto-accept'), admin).send({ on: 'yes' })).status, 400);
  });

  it('accept for a catalogue: every pending dictionary suggestion as one event; undo takes it back', async () => {
    const { catalogId, findingIds } = await makeCatalog(admin.orgId, [
      { rawName: 'sut 1l', suggestedMxik: codes[0]!, confidence: 0.99 },
      { rawName: 'boshqa', suggestedMxik: codes[1]!, confidence: 0.99 },
    ]);
    await db.finding.update({ where: { id: findingIds[0]! }, data: { evidence: { stage: 'dictionary' } } });
    assert.equal((await as(http().post(`/api/catalogs/${catalogId}/dictionary/accept`), viewer).send()).status, 403);
    const foreign = await as(http().post(`/api/catalogs/${catalogId}/dictionary/accept`), stranger).send();
    assert.equal(bodyOf<Ok>(foreign).ok, false);
    const res = await as(http().post(`/api/catalogs/${catalogId}/dictionary/accept`), accountant).send();
    const done = shaped(d.acceptForCatalog, res.body) as { ok: true; count: number; ids: string[]; eventId: string };
    assert.equal(done.count, 1);
    assert.deepEqual(done.ids, [findingIds[0]]);
    assert.equal((await db.finding.findUniqueOrThrow({ where: { id: findingIds[0]! } })).decisionSource, 'dictionary');
    const undone = await as(http().post('/api/decisions/undo'), accountant).send({ eventId: done.eventId });
    assert.equal(bodyOf<Ok>(undone).ok, true);
  });
});
