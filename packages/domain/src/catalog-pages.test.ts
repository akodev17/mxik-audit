import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import {
  catalogDiff, catalogHeader, catalogListPage, catalogReport, catalogReview, catalogSummary, catalogVersions, reportJson, shareView,
} from './catalog-pages.js';
import { makeClient, makeClientCatalog, makePerson } from './firm-test-fixtures.js';
import type { PdfRow, ReportPdfData } from './pdf/report-data.js';
import type { CurrentUser } from './session.js';
import { createShareLink } from './share.js';
import { dbSkipReason, dropOrgs, makeOrg } from './test-fixtures.js';

const skip = await dbSkipReason();

const row = (decidedBy: string | null): PdfRow => ({
  rowIndex: 0, product: 'Guruch', type: 'MISMATCH', current: null, suggested: null, decision: 'accepted', chosen: null,
  source: 'manual', automatic: false, decidedBy,
});

const data = (logo: ReportPdfData['logo']): ReportPdfData => ({
  firmName: 'Firma', logo, clientName: 'Mijoz', filename: 'k.xlsx', generatedAt: new Date('2026-10-01T00:00:00Z'), classifierDate: null,
  totalRows: 1, riskyRows: 1, byType: [], markingRows: 0, rows: [row('buxgalter@test.local')], truncated: false, checks: { purchases: false },
  counts: { detected: 1, suggested: 0, decided: 1, automatic: 0, unresolved: 0 }, rowReview: { done: 1, partial: 0, open: 0 }, limits: null, pipeline: null,
});

describe('reportJson', () => {
  it('turns the logo into a data: URL and keeps who decided only on the internal report', () => {
    const internal = reportJson(data({ data: Buffer.from([1, 2, 3]), mime: 'image/png' }), 'internal');
    assert.equal(internal.logoUrl, 'data:image/png;base64,AQID');
    assert.equal('logo' in internal, false);
    assert.equal(internal.rows[0]?.decidedBy, 'buxgalter@test.local');
    const client = reportJson(data(null), 'client');
    assert.equal(client.logoUrl, null);
    assert.equal(client.rows[0]?.decidedBy, null);
  });
});

describe('catalogue screens (database)', { skip }, () => {
  const orgs: string[] = [];
  let admin: CurrentUser;
  let stranger: CurrentUser;
  let clientId = '';
  let catalogId = '';

  before(async () => {
    const org = await makeOrg();
    const other = await makeOrg();
    orgs.push(org.orgId, other.orgId);
    admin = { ...(await makePerson(org.orgId, 'admin')), demo: false, clientId: null };
    stranger = { ...(await makePerson(other.orgId, 'admin')), demo: false, clientId: null };
    clientId = await makeClient(org.orgId, 'Mijoz A');
    await makeClient(org.orgId, 'Mijoz B');
    catalogId = (await makeClientCatalog(org.orgId, clientId, [{ name: 'Guruch', findings: [{ type: 'MISMATCH' }] }])).catalogId;
    await makeClientCatalog(org.orgId, clientId, [{ name: 'Non', findings: [] }], { status: 'uploaded' });
  });
  after(async () => {
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('the list: client filter options, catalogues apart from drafts, drafts only for writers', async () => {
    const page = await catalogListPage(admin, { clientId: 'all', page: 0, kind: 'catalogs' });
    assert.deepEqual(page.clients.map((c) => c.name), ['Mijoz A', 'Mijoz B']);
    assert.deepEqual(page.items.map((i) => i.id), [catalogId]);
    assert.equal(page.pageSize, 50);
    assert.equal((await catalogListPage(admin, { page: 0, kind: 'drafts' })).total, 1);
    const viewer = { ...(await makePerson(admin.orgId, 'viewer')), demo: false, clientId: null };
    assert.equal((await catalogListPage(viewer, { page: 0, kind: 'drafts' })).total, 0);
    assert.equal((await catalogListPage({ ...admin, demo: true }, { page: 0, kind: 'drafts' })).total, 0);
  });

  it('every read is null for another org\'s catalogue', async () => {
    assert.equal(await catalogHeader(stranger, catalogId), null);
    assert.equal(await catalogSummary(stranger, catalogId), null);
    assert.equal(await catalogVersions(stranger, catalogId), null);
    assert.equal(await catalogReview(stranger, catalogId), null);
    assert.deepEqual(await catalogDiff(stranger, catalogId, {}), { found: false, diff: null });
    assert.deepEqual(await catalogReport(stranger, catalogId), { ok: false, reason: 'not_found' });
  });

  it('header, summary, review and report of the org\'s own catalogue', async () => {
    const header = await catalogHeader(admin, catalogId);
    assert.equal(header?.client.id, clientId);
    assert.equal(header?.exportLocked, false);
    assert.equal(header?.demo, false);
    assert.equal((await catalogSummary(admin, catalogId))?.riskyRows, 1);
    const review = await catalogReview(admin, catalogId);
    assert.equal(review?.review, null);
    assert.ok(review?.assignable.some((m) => m.id === admin.userId));
    const report = await catalogReport(admin, catalogId);
    assert.ok(report.ok);
    assert.equal(report.report.totalRows, 1);
  });

  it('shareView counts a view and hides who decided; an unknown token is null', async () => {
    const link = await createShareLink(admin, catalogId, { days: 7, includePdf: false });
    const token = link?.url.split('/r/')[1] ?? '';
    const view = await shareView(token);
    assert.equal(view?.includePdf, false);
    assert.ok(view?.report.rows.every((r) => r.decidedBy === null));
    assert.equal((await db.shareLink.findFirst({ where: { catalogId }, select: { views: true } }))?.views, 1);
    assert.equal(await shareView('nope'), null);
  });
});
