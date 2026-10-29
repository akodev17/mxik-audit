// The dictionary module through the real app: the page's list (compared with the domain read the
// web page makes), the accept-all button on a catalogue, confirmations, admin-only edits and deletes,
// the auto-accept setting and a finding's provenance;
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

  it('update: admins only; a bad code answers the form message; an edit needs a fresh confirmation unless confirmed now', async () => {
    const t = i18nFor('uz');
    assert.equal((await as(http().patch(`/api/dictionary/${entries[0]}`), accountant).send({ code: codes[2] })).status, 403);
    assert.equal((await as(http().patch(`/api/dictionary/${entries[0]}`), viewer).send({ code: codes[1] })).status, 403);
    const bad = await as(http().patch(`/api/dictionary/${entries[0]}`), admin).send({ code: '123' });
    assert.deepEqual(bad.body, { ok: false, error: t.ta.wsX.dict.codeFormat });
    const missing = await as(http().patch(`/api/dictionary/${entries[0]}`), admin).send({ code: '99999999999999999' });
    assert.deepEqual(missing.body, { ok: false, error: t.ta.msg.codeNotInClassifier });
    const ok = await as(http().patch(`/api/dictionary/${entries[0]}`), admin).send({ code: codes[2] });
    assert.deepEqual(shaped(d.update, ok.body), { ok: true });
    let row = await db.firmMapping.findUniqueOrThrow({ where: { id: entries[0]! } });
    assert.deepEqual([row.code, row.confirmations, row.needsReconfirm, row.source], [codes[2], 0, true, 'edit']);
    await as(http().patch(`/api/dictionary/${entries[0]}`), admin).send({ code: codes[2], confirm: true });
    row = await db.firmMapping.findUniqueOrThrow({ where: { id: entries[0]! } });
    assert.deepEqual([row.confirmations, row.needsReconfirm], [1, false]);
    const foreign = await as(http().patch(`/api/dictionary/${entries[0]}`), stranger).send({ code: codes[1] });
    assert.deepEqual(foreign.body, { ok: false, error: t.t.errorGeneric });
  });

  it('confirm: a writer confirms an entry as it is; a disputed one only an admin; a viewer never', async () => {
    const t = i18nFor('uz');
    assert.equal((await as(http().post(`/api/dictionary/${entries[1]}/confirm`), viewer).send()).status, 403);
    await db.firmMapping.update({ where: { id: entries[1]! }, data: { needsReconfirm: true } });
    assert.deepEqual(shaped(d.confirm, (await as(http().post(`/api/dictionary/${entries[1]}/confirm`), accountant).send()).body), { ok: true });
    let row = await db.firmMapping.findUniqueOrThrow({ where: { id: entries[1]! } });
    assert.deepEqual([row.confirmations, row.needsReconfirm, row.source], [2, false, 'confirm']);
    await db.firmMapping.update({ where: { id: entries[1]! }, data: { disputedAt: new Date(), disputedBy: accountant.userId } });
    assert.deepEqual((await as(http().post(`/api/dictionary/${entries[1]}/confirm`), accountant).send()).body, { ok: false, error: t.ta.wsX.dict.disputedAdminOnly });
    assert.deepEqual((await as(http().post(`/api/dictionary/${entries[1]}/confirm`), admin).send()).body, { ok: true });
    row = await db.firmMapping.findUniqueOrThrow({ where: { id: entries[1]! } });
    assert.equal(row.disputedAt, null);
    assert.equal(bodyOf<Ok>(await as(http().post(`/api/dictionary/${entries[1]}/confirm`), stranger).send()).ok, false);
  });

  it('remove: admins only, for their own org', async () => {
    assert.equal((await as(http().delete(`/api/dictionary/${entries[2]}`), viewer)).status, 403);
    assert.equal((await as(http().delete(`/api/dictionary/${entries[2]}`), accountant)).status, 403);
    assert.equal(bodyOf<Ok>(await as(http().delete(`/api/dictionary/${entries[2]}`), stranger)).ok, false);
    assert.deepEqual((await as(http().delete(`/api/dictionary/${entries[2]}`), admin)).body, { ok: true });
    assert.equal(await db.firmMapping.count({ where: { id: entries[2]! } }), 0);
  });

  it('provenance: the entry behind a dictionary suggestion for any reader who sees every client; 404 outside', async () => {
    const { findingIds } = await makeCatalog(admin.orgId, [{ rawName: 'sut 1l', suggestedMxik: codes[2]!, confidence: 0.96 }]);
    await db.finding.update({ where: { id: findingIds[0]! }, data: { evidence: { stage: 'dictionary', barcode: false, exactName: false, matchedWords: [], unit: 'none', rerankReason: null, rerankNone: false, dictionaryEntryId: entries[0]! } } });
    const res = await get(`/api/findings/${findingIds[0]}/provenance`, viewer);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const body = shaped(d.provenance, res.body) as { dictionary: { entryId: string; label: string; createdBy: string | null } | null; carriedFrom: unknown };
    assert.equal(body.dictionary?.entryId, entries[0]);
    assert.equal(body.dictionary?.label, 'sut 1l');
    assert.equal(body.dictionary?.createdBy, admin.email);
    assert.equal(body.carriedFrom, null);
    assert.equal((await get(`/api/findings/${findingIds[0]}/provenance`, stranger)).status, 404);
    assert.equal((await get(`/api/findings/${findingIds[0]}/provenance`, scoped)).status, 404, 'a catalogue without a client is not a scoped member\'s');
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
