import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { dashboard, weekSeries, weekStart } from './dashboard.js';
import { makeClient, makeClientCatalog, makePerson, type Person } from './firm-test-fixtures.js';
import { byClient, firmResultsFile, resultsCsv, resultTotals, sortResults, type CatalogResult } from './firm-results.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();
const DAY = 86_400_000;

describe('value measures: pure parts', () => {
  it('weeks start on Monday in Tashkent time', () => {
    // Sunday 2026-11-01 20:00 UTC is Monday 01:00 in Tashkent.
    assert.equal(weekStart(new Date('2026-11-01T20:00:00Z')), '2026-11-02');
    assert.equal(weekStart(new Date('2026-11-01T18:00:00Z')), '2026-10-26');
    assert.equal(weekStart(new Date('2026-10-26T00:00:00+05:00')), '2026-10-26');
  });

  it('twelve weeks oldest first, counts in the right week, older audits left out', () => {
    const now = new Date('2026-10-30T10:00:00Z');
    const k = (at: string, rows: number) => ({ createdAt: new Date(at), rowsChecked: rows });
    const weeks = weekSeries([k('2026-10-29T08:00:00Z', 10), k('2026-10-26T01:00:00Z', 5), k('2026-10-20T08:00:00Z', 7), k('2026-01-05T08:00:00Z', 99)], now);
    assert.equal(weeks.length, 12);
    assert.equal(weeks.at(-1)?.weekStart, '2026-10-26');
    assert.equal(weeks[0]?.weekStart, '2026-08-10');
    assert.deepEqual(weeks.at(-1), { weekStart: '2026-10-26', catalogs: 2, rows: 15 });
    assert.deepEqual(weeks.at(-2), { weekStart: '2026-10-19', catalogs: 1, rows: 7 });
    assert.equal(weeks.reduce((n, w) => n + w.catalogs, 0), 3);
  });

  it('sums per client, keeps clients without audits at zero, sorts the latest audit first', () => {
    const at = (d: string) => new Date(d);
    const k = (clientId: string, createdAt: Date, extra: Partial<CatalogResult> = {}): CatalogResult => ({
      id: `${clientId}-${createdAt.getTime()}`, clientId, createdAt, rowsChecked: 10, rowsFailed: 0, issues: 4, resolved: 2, decisions: 3, autoDecisions: 1, ...extra,
    });
    const rows = byClient(
      [{ id: 'a', name: 'Alfa', isDefault: false }, { id: 'b', name: 'Beta', isDefault: false }, { id: 'c', name: 'Gamma', isDefault: false }],
      [k('a', at('2026-10-01')), k('a', at('2026-10-20'), { rowsFailed: 2 }), k('b', at('2026-10-25')), k('x', at('2026-10-26'))],
    );
    assert.deepEqual(rows.map((r) => [r.name, r.catalogs, r.rowsChecked, r.rowsFailed]), [['Alfa', 2, 20, 2], ['Beta', 1, 10, 0], ['Gamma', 0, 0, 0]]);
    assert.deepEqual(sortResults(rows).map((r) => r.name), ['Beta', 'Alfa', 'Gamma']);
    assert.deepEqual(resultTotals(rows), { catalogs: 3, rowsChecked: 30, rowsFailed: 2, issues: 12, resolved: 6, decisions: 9, autoDecisions: 3 });
  });

  it('writes a formula-safe CSV with a byte-order mark and localised headers', () => {
    const csv = resultsCsv([{ clientId: 'a', name: '=HYPERLINK("x")', isDefault: false, catalogs: 1, rowsChecked: 5, rowsFailed: 1, issues: 2, resolved: 1, decisions: 1, autoDecisions: 0, lastAuditAt: new Date('2026-10-20T10:00:00Z') }], 'uz');
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.ok(csv.slice(1).startsWith('Mijoz,'));
    assert.match(csv, /"'=HYPERLINK\(""x""\)",1,5,1,2,1,1,20\.10\.2026/);
  });
});

describe('value measures and the per-client results (database)', { skip }, () => {
  let org: TestActor;
  let other: TestActor;
  let admin: Person;
  let scoped: Person;
  let alfa = '';
  let beta = '';

  before(async () => {
    org = await makeOrg();
    other = await makeOrg();
    admin = await makePerson(org.orgId, 'admin');
    alfa = await makeClient(org.orgId, 'Alfa');
    beta = await makeClient(org.orgId, 'Beta');
    const archived = await makeClient(org.orgId, 'Arxiv', { archived: true });
    scoped = await makePerson(org.orgId, 'accountant', [beta]);

    // Alfa: two audited versions (3 + 2 rows) and one upload still waiting (never counted).
    const v1 = await makeClientCatalog(org.orgId, alfa, [
      { name: 'Guruch', findings: [{ severity: 'high', decision: 'accepted' }] },
      { name: 'Shakar', findings: [{ severity: 'medium' }, { type: 'PRIVILEGE_CODE', severity: 'info', decision: 'accepted' }] },
      { name: 'Tuz', findings: [] },
    ], { createdAt: new Date(Date.now() - 14 * DAY) });
    const v2 = await makeClientCatalog(org.orgId, alfa, [
      { name: 'Guruch', findings: [{ severity: 'high', decision: 'accepted' }] },
      { name: 'Un', findings: [{ severity: 'high', decision: 'rejected' }] },
    ], { previousId: v1.catalogId });
    await db.finding.update({ where: { id: v2.findingIds[0]![0]! }, data: { decisionSource: 'carry_over' } });
    await makeClientCatalog(org.orgId, alfa, [{ name: 'Kutmoqda', findings: [{ severity: 'high' }] }], { status: 'uploaded' });

    // Beta: one audited catalogue of 3 rows, one of which failed its check after the retries.
    const b = await makeClientCatalog(org.orgId, beta, [
      { name: 'Yog', findings: [{ severity: 'high', decision: 'accepted' }] },
      { name: 'Choy', findings: [{ severity: 'high' }] },
      { name: 'Xato', findings: [] },
    ]);
    await db.catalogItem.updateMany({ where: { catalogId: b.catalogId, rawName: 'Xato' }, data: { checkError: 'database: test' } });
    await db.finding.update({ where: { id: b.findingIds[0]![0]! }, data: { decisionSource: 'dictionary_auto' } });

    // Neither the archived client nor another org may count.
    await makeClientCatalog(org.orgId, archived, [{ name: 'Eski', findings: [{ severity: 'high', decision: 'accepted' }] }]);
    await makeClientCatalog(other.orgId, await makeClient(other.orgId, 'Begona'), [{ name: 'Begona', findings: [{ severity: 'high', decision: 'accepted' }] }]);
    await db.organization.update({ where: { id: org.orgId }, data: { minutesPerDecision: 4 } });
  });
  after(async () => {
    await dropOrgs([org.orgId, other.orgId]);
    await db.$disconnect();
  });

  const viewer = (p: Person) => ({ orgId: p.orgId, role: p.role, clientIds: p.clientIds });

  it('an admin sees both clients: rows without failed ones, issues, resolved, decisions, time saved', async () => {
    const { value } = await dashboard(viewer(admin), null);
    assert.equal(value.catalogs, 3, 'two versions of Alfa and Beta; the waiting upload is not audited');
    assert.equal(value.rowsChecked, 3 + 2 + 2);
    assert.equal(value.rowsFailed, 1);
    assert.equal(value.issues, 2 + 2 + 2, 'high and medium only');
    assert.equal(value.resolved, 1 + 2 + 1);
    assert.equal(value.decisions, 2 + 2 + 1, 'every decided finding, the info one included');
    assert.equal(value.autoDecisions, 2, 'carry-over and dictionary auto-accept');
    assert.equal(value.minutesPerDecision, 4);
    assert.equal(value.minutesSaved, 5 * 4);
    assert.deepEqual(value.clients.map((c) => c.name).sort(), ['Alfa', 'Beta']);
    assert.equal(value.clientsWithResults, 2);
    const a = value.clients.find((c) => c.clientId === alfa);
    assert.equal(a?.catalogs, 2);
    assert.equal(a?.rowsChecked, 5);
    assert.equal(value.weeks.reduce((n, w) => n + w.catalogs, 0), 3);
  });

  it('a scoped accountant sees only their client', async () => {
    const { value } = await dashboard(viewer(scoped), null);
    assert.deepEqual(value.clients.map((c) => c.clientId), [beta]);
    assert.equal(value.catalogs, 1);
    assert.equal(value.rowsChecked, 2);
    assert.equal(value.rowsFailed, 1);
    assert.equal(value.issues, 2);
    assert.equal(value.resolved, 1);
    assert.equal(value.decisions, 1);
    assert.equal(value.minutesSaved, 4);
  });

  it('the admin\'s accountant filter narrows the measures to that accountant\'s clients', async () => {
    const { value } = await dashboard(viewer(admin), scoped.userId);
    assert.deepEqual(value.clients.map((c) => c.clientId), [beta]);
    assert.equal(value.decisions, 1);
  });

  it('the download lists every client the dashboard shows, and nothing else', async () => {
    const all = await firmResultsFile(viewer(admin), { format: 'csv', accountantId: null }, 'uz');
    const text = String(all.body);
    assert.match(text, /Alfa,2,5,0,4,3,4,/);
    assert.match(text, /Beta,1,2,1,2,1,1,/);
    assert.doesNotMatch(text, /Arxiv|Begona/);
    assert.match(all.headers['content-disposition'] ?? '', /attachment; filename="mijozlar-natijalari-\d{4}-\d{2}-\d{2}\.csv"/);

    const mine = String((await firmResultsFile(viewer(scoped), { format: 'csv', accountantId: null }, 'ru')).body);
    assert.ok(mine.slice(1).startsWith('Клиент,'), 'Russian headers after the byte-order mark');
    assert.match(mine, /Beta/);
    assert.doesNotMatch(mine, /Alfa/);
    // A non-admin cannot widen or move the scope with the accountant filter.
    assert.doesNotMatch(String((await firmResultsFile(viewer(scoped), { format: 'csv', accountantId: admin.userId }, 'uz')).body), /Alfa/);

    const xlsx = await firmResultsFile(viewer(admin), { format: 'xlsx', accountantId: null }, 'uz');
    assert.equal(xlsx.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.ok(xlsx.body instanceof Uint8Array && xlsx.body.length > 0);
  });
});
