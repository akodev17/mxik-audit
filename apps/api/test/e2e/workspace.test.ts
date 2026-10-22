// The workspace module through the real app on a fixture catalogue: grid rows (compared with the
// domain calls the web page makes, cursor and order included), decisions and undo, bulk, comments,
// views, code lookup, the queue and the dashboard; refusals for a viewer, another org and a demo.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { dbSkipReason, dropOrgs, liveCodes, makeCatalog } from '@tasnivo/domain/test-fixtures';
import { searchClassifier } from '@tasnivo/domain/audit-runner';
import { lookupCodes } from '@tasnivo/domain/code-lookup';
import { decodeCursor, workspaceChipCounts, workspaceCount, workspacePageIds } from '@tasnivo/domain/workspace';
import { readFilter } from '@tasnivo/domain/workspace-filter';
import { gridRows } from '@tasnivo/domain/workspace-rows';
import { bodyOf, serverOf, startApp } from '../helpers';
import { as, member, orgWithAdmin, shaped, type Member } from './workspace-fixtures';

const skip = await dbSkipReason();
const w = endpoints.workspace;
const ROWS = 125;

type Ok = { ok: boolean };

/** A value as it arrives on the wire (Dates become ISO strings). */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('workspace module (e2e)', { skip }, () => {
  let app: INestApplication;
  const orgs: string[] = [];
  let admin: Member;
  let viewer: Member;
  let accountant: Member;
  let stranger: Member;
  let demo: Member;
  let catalogId: string;
  let findingIds: string[];
  let codes: string[];
  const http = () => request(serverOf(app));
  const get = (path: string, who: Member) => as(http().get(path), who, false);
  const post = (path: string, who: Member, body: object = {}) => as(http().post(path), who).send(body);

  before(async () => {
    app = await startApp();
    admin = await orgWithAdmin(orgs);
    viewer = await member(admin.orgId, 'viewer');
    accountant = await member(admin.orgId, 'accountant');
    stranger = await orgWithAdmin(orgs);
    demo = await orgWithAdmin(orgs, 'demo');
    codes = await liveCodes(5);
    // Confidence spread (and a few without a suggestion) so the risk sort has ties and nulls to order.
    const rows = Array.from({ length: ROWS }, (_, i) => ({
      rawName: `Mahsulot ${String(i).padStart(3, '0')} sut`,
      unit: i % 3 === 0 ? 'kg' : 'dona',
      suggestedMxik: i % 10 === 9 ? null : codes[i % codes.length]!,
      confidence: i % 10 === 9 ? null : [0.95, 0.5, 0.95, 0.7, 0.91][i % 5]!,
    }));
    ({ catalogId, findingIds } = await makeCatalog(admin.orgId, rows));
  });

  after(async () => {
    await app?.close();
    await dropOrgs(orgs);
  });

  it('401 without a session, 403 without the CSRF header on a mutation', async () => {
    assert.equal((await http().get(`/api/catalogs/${catalogId}/rows`)).status, 401);
    const bare = await http().post(`/api/findings/${findingIds[0]}/decision`).set('Cookie', admin.cookie).send({ decision: 'accepted' });
    assert.equal(bare.status, 403);
    assert.equal(bodyOf(bare).error.code, 'csrf');
  });

  it('rows: every page equals the domain page the web renders (ids, order, cursor), byte for byte', async () => {
    const queries: Record<string, string>[] = [{}, { sort: 'row' }, { q: 'sut', dec: 'all' }, { type: 'MISSING', sort: 'risk' }];
    for (const query of queries) {
      const filter = readFilter(query);
      let cursor = '';
      let pages = 0;
      do {
        const res = await get(`/api/catalogs/${catalogId}/rows?${new URLSearchParams({ ...query, cursor })}`, viewer);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        shaped(w.rows, res.body);
        const page = await workspacePageIds(catalogId, filter, decodeCursor(cursor), 120);
        const expected = { rows: await gridRows(admin.orgId, catalogId, page.ids, 'uz'), next: page.next };
        assert.equal(res.text, JSON.stringify(expected), `${JSON.stringify(query)} page ${pages}`);
        cursor = bodyOf<{ next: string | null }>(res).next ?? '';
        pages += 1;
      } while (cursor);
      assert.equal(pages, 2, 'more than one page, so the cursor itself is compared');
    }
  });

  it('rows: the first page leads with a linked row that is not on it, as ?row= does on the page', async () => {
    const page = await workspacePageIds(catalogId, readFilter({}), null, 120);
    const away = findingIds.find((id) => !page.ids.includes(id))!;
    const res = await get(`/api/catalogs/${catalogId}/rows?row=${away}`, admin);
    const { rows } = bodyOf<{ rows: { findingId: string }[] }>(res);
    assert.equal(rows[0]?.findingId, away);
    assert.equal(rows.length, page.ids.length + 1);
  });

  it('rows is null and counts 404 for another org\'s catalogue; counts equal the domain', async () => {
    const other = await get(`/api/catalogs/${catalogId}/rows`, stranger);
    assert.equal(other.status, 200);
    assert.equal(other.body, null);
    assert.equal((await get(`/api/catalogs/${catalogId}/counts`, stranger)).status, 404);
    const res = await get(`/api/catalogs/${catalogId}/counts?q=sut`, viewer);
    const filter = readFilter({ q: 'sut' });
    assert.deepEqual(shaped(w.counts, res.body), { count: await workspaceCount(catalogId, filter), chips: await workspaceChipCounts(catalogId, filter) });
  });

  it('money at risk: null without a sales column, 404 for another org', async () => {
    const res = await get(`/api/catalogs/${catalogId}/money-at-risk`, viewer);
    assert.equal(res.status, 200);
    assert.equal(res.body, null);
    assert.equal((await get(`/api/catalogs/${catalogId}/money-at-risk`, stranger)).status, 404);
  });

  it('row detail for the org, null for another org', async () => {
    const mine = await get(`/api/findings/${findingIds[0]}`, viewer);
    assert.equal((shaped(w.rowDetail, mine.body) as { findingId: string }).findingId, findingIds[0]);
    assert.equal((await get(`/api/findings/${findingIds[0]}`, stranger)).body, null);
  });

  it('decide → already decided → undo; a viewer is refused, another org gets not_found', async () => {
    const id = findingIds[0]!;
    const refused = await post(`/api/findings/${id}/decision`, viewer, { decision: 'accepted' });
    assert.equal(refused.status, 403);
    assert.equal(bodyOf(refused).error.code, 'forbidden');
    const foreign = await post(`/api/findings/${id}/decision`, stranger, { decision: 'accepted' });
    assert.equal(foreign.status, 200);
    assert.equal((shaped(w.decide, foreign.body) as { code?: string }).code, 'not_found');

    const done = await post(`/api/findings/${id}/decision`, accountant, { decision: 'accepted' });
    const ok = shaped(w.decide, done.body) as { ok: true; eventId: string };
    assert.equal(ok.ok, true);
    const again = shaped(w.decide, (await post(`/api/findings/${id}/decision`, admin, { decision: 'rejected' })).body) as { ok: false; code: string; decidedBy: string };
    assert.equal(again.code, 'already_decided');
    assert.equal(again.decidedBy, accountant.email);

    const undone = shaped(w.undo, (await post('/api/decisions/undo', accountant, { eventId: ok.eventId })).body) as { ok: true; findingIds: string[] };
    assert.deepEqual(undone.findingIds, [id]);
    assert.equal((await db.finding.findUniqueOrThrow({ where: { id } })).decision, 'pending');
    const nothing = shaped(w.undo, (await post('/api/decisions/undo', accountant, { lastInCatalog: catalogId })).body) as { ok: boolean; error?: string };
    assert.equal(nothing.ok, false);
    assert.ok(nothing.error && nothing.error.length > 0);
  });

  it('a group decision, the sure band preview and accept, then undo of the band', async () => {
    const group = shaped(w.decideGroup, (await post('/api/decisions/group', admin, { findingIds: findingIds.slice(1, 3), decision: 'rejected' })).body) as { ok: true; count: number; eventId: string };
    assert.equal(group.count, 2);
    assert.equal(bodyOf<Ok>(await post('/api/decisions/undo', admin, { eventId: group.eventId })).ok, true);

    const preview = shaped(w.previewSure, (await post(`/api/catalogs/${catalogId}/accept-sure/preview`, admin, { filter: null })).body) as { ok: true; total: number; willAccept: number };
    assert.ok(preview.total > 0);
    const low = await post(`/api/catalogs/${catalogId}/accept-sure`, admin, { minConfidence: 0.5 });
    assert.equal(low.status, 400, 'below the high band is refused, as the action\'s schema did');
    const sure = shaped(w.acceptSure, (await post(`/api/catalogs/${catalogId}/accept-sure`, admin, { minConfidence: 0.9, filter: { q: 'sut' } })).body) as { ok: true; count: number; eventId: string };
    assert.equal(sure.count, preview.willAccept);
    assert.equal(bodyOf<Ok>(await post('/api/decisions/undo', admin, { eventId: sure.eventId })).ok, true);
  });

  it('split, new-code request text, wrong-suggestion feedback, name from barcode', async () => {
    const id = findingIds[4]!;
    assert.deepEqual(shaped(w.split, (await post(`/api/findings/${id}/split`, admin)).body), { ok: true });
    const text = await get(`/api/findings/${id}/code-request`, viewer);
    assert.equal(typeof shaped(w.newCodeRequest, text.body), 'string');
    assert.equal((await get(`/api/findings/${id}/code-request`, stranger)).body, null);
    assert.deepEqual((await post(`/api/findings/${id}/wrong-suggestion`, admin, { reason: 'unit', note: 'kg emas' })).body, { ok: true });
    assert.equal((await post(`/api/findings/${id}/wrong-suggestion`, admin, { reason: 'nonsense' })).status, 400);
    assert.equal((await post(`/api/findings/${id}/name-from-barcode`, admin)).body, false);
  });

  it('bulk: preview, flag a filter, undo the flags', async () => {
    const body = { target: { filter: { q: 'sut', dec: 'all' } }, action: { kind: 'flag', flag: 'ask_client' } };
    const preview = shaped(w.bulkPreview, (await post(`/api/catalogs/${catalogId}/bulk/preview`, admin, body)).body) as { ok: true; willTouch: number };
    assert.equal(preview.willTouch, ROWS);
    const applied = shaped(w.bulkApply, (await post(`/api/catalogs/${catalogId}/bulk`, admin, body)).body) as { ok: true; count: number; eventId: string };
    assert.equal(applied.count, ROWS);
    assert.equal(await db.finding.count({ where: { item: { catalogId }, flag: 'ask_client' } }), ROWS);
    const undone = shaped(w.bulkUndoFlags, (await post(`/api/bulk-events/${applied.eventId}/undo-flags`, admin)).body) as { ok: true; findingIds: string[] };
    assert.equal(undone.findingIds.length, ROWS);
    assert.equal(await db.finding.count({ where: { item: { catalogId }, flag: 'ask_client' } }), 0);
    assert.equal((await post(`/api/catalogs/${catalogId}/bulk`, viewer, body)).status, 403);
    const foreign = await post(`/api/catalogs/${catalogId}/bulk`, stranger, body);
    assert.equal(bodyOf<Ok>(foreign).ok, false);
  });

  it('comments and flags: post answers the thread; viewers read only', async () => {
    const id = findingIds[5]!;
    const thread = shaped(w.postComment, (await post(`/api/findings/${id}/comments`, accountant, { body: 'Mijozdan soʻrash kerak' })).body) as { body: string; author: string }[];
    assert.equal(thread.length, 1);
    assert.equal(thread[0]!.author, accountant.email);
    assert.deepEqual(shaped(w.comments, (await get(`/api/findings/${id}/comments`, viewer)).body), thread);
    assert.deepEqual((await get(`/api/findings/${id}/comments`, stranger)).body, []);
    assert.equal((await post(`/api/findings/${id}/comments`, viewer, { body: 'x' })).status, 403);
    assert.equal((await as(http().put(`/api/findings/${id}/flag`), accountant).send({ flag: 'resolved' })).body, true);
    assert.equal((await db.finding.findUniqueOrThrow({ where: { id } })).flag, 'resolved');
    assert.equal((await as(http().put(`/api/findings/${id}/flag`), stranger).send({ flag: null })).body, false);
  });

  it('views: save, default, list, remove; a demo session may not save', async () => {
    const params = { type: null, q: 'sut', pending: true, comments: false, sort: 'row', density: 'compact', grouped: false };
    const saved = shaped(w.saveView, (await post('/api/views', accountant, { name: 'Sut', params, makeDefault: true })).body) as { ok: boolean; views: { id: string; isDefault: boolean }[] };
    assert.equal(saved.ok, true);
    assert.equal(saved.views.length, 1);
    assert.equal(saved.views[0]!.isDefault, true);
    const viewId = saved.views[0]!.id;
    assert.deepEqual(shaped(w.views, (await get('/api/views', accountant)).body), saved.views);
    const cleared = bodyOf<{ views: { isDefault: boolean }[] }>(await as(http().put('/api/views/default'), accountant).send({ viewId: null }));
    assert.equal(cleared.views[0]?.isDefault, false);
    const removed = bodyOf<unknown>(await as(http().delete(`/api/views/${viewId}`), accountant));
    assert.deepEqual(removed, { ok: true, views: [] });
    const demoSave = await post('/api/views', demo, { name: 'x', params, makeDefault: false });
    assert.equal(demoSave.status, 403);
    assert.equal(bodyOf(demoSave).error.code, 'demo');
    assert.equal((await post('/api/views', viewer, { name: 'x', params, makeDefault: false })).status, 403);
  });

  it('code lookup: [] under two characters; hits in the viewer\'s language otherwise', async () => {
    assert.deepEqual((await get('/api/codes/search?q=s', viewer)).body, []);
    const res = await get('/api/codes/search?q=sut', viewer);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const hits = shaped(w.lookupCodes, res.body) as { code: string }[];
    assert.ok(hits.length <= 10);
    assert.deepEqual(res.body, wire(await lookupCodes('sut', 'uz', searchClassifier)), 'the same hits as the server action');
    const ru = await get('/api/codes/search?q=sut', viewer).set('Cookie', `${viewer.cookie}; mxik_locale=ru`);
    assert.deepEqual(ru.body, wire(await lookupCodes('sut', 'ru', searchClassifier)));
    const again = await get('/api/codes/search?q=sut', viewer);
    assert.deepEqual(again.body, res.body, 'the process keeps one store: same answer on the second call');
  });

  it('queue and dashboard answer the contract shape; the accountant filter is an admin\'s', async () => {
    const queue = await get('/api/queue', admin);
    assert.equal(queue.status, 200, JSON.stringify(queue.body));
    const q = shaped(w.queue, queue.body) as { accountants: unknown[] | null };
    assert.ok(Array.isArray(q.accountants));
    assert.equal((shaped(w.queue, (await get('/api/queue', viewer)).body) as { accountants: null }).accountants, null);
    assert.equal((await get('/api/queue?severity=low', admin)).status, 400);

    const dash = await get(`/api/dashboard?accountant=${accountant.userId}&rv=mine`, admin);
    assert.equal(dash.status, 200, JSON.stringify(dash.body));
    const d = shaped(w.dashboard, dash.body) as { role: string; selected: { id: string } | null };
    assert.equal(d.role, 'admin');
    assert.equal(d.selected?.id, accountant.userId);
    const asViewer = shaped(w.dashboard, (await get(`/api/dashboard?accountant=${accountant.userId}`, viewer)).body) as { selected: null; workload: null };
    assert.equal(asViewer.selected, null);
    assert.equal(asViewer.workload, null);
  });
});
