import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from './db.js';
import { parseQuery, productHref, productStatus, search, type SearchUser } from './search.js';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg, type TestActor } from './test-fixtures.js';

describe('palette query parsing', () => {
  it('reads five or more digits, with spaces or dots, as a code prefix', () => {
    assert.equal(parseQuery(' 10202 ').digits, '10202');
    assert.equal(parseQuery('102 020 010').digits, '102020010');
    assert.equal(parseQuery('1020.2001').digits, '10202001');
    assert.equal(parseQuery('1020').digits, null);
    assert.equal(parseQuery('guruch 10202').digits, null);
  });

  it('needs at least two characters', () => {
    assert.equal(parseQuery(' a ').tooShort, true);
    assert.equal(parseQuery('ab').tooShort, false);
    assert.equal(parseQuery('x'.repeat(300)).text.length, 100);
  });
});

describe('product status and link', () => {
  const f = (severity: 'high' | 'medium' | 'info', decision: 'pending' | 'accepted' | 'rejected', type: 'MISSING' | 'NOT_PURCHASED' = 'MISSING') => ({ severity, decision, type });

  it('separates system findings that need a look from decided and informational rows', () => {
    assert.equal(productStatus([f('high', 'pending')]), 'attention');
    assert.equal(productStatus([f('medium', 'accepted'), f('info', 'pending', 'NOT_PURCHASED')]), 'decided');
    assert.equal(productStatus([f('info', 'pending', 'NOT_PURCHASED')]), 'info');
    assert.equal(productStatus([]), 'clean');
  });

  it('links to the workspace with every decision shown, and the type for informational rows', () => {
    assert.equal(productHref('c1', 'Guruch 1 kg', [f('high', 'accepted')]), '/catalogs/c1?q=Guruch+1+kg&pending=0&v=0');
    assert.equal(productHref('c1', 'Un', [f('info', 'pending', 'NOT_PURCHASED')]), '/catalogs/c1?q=Un&pending=0&v=0&type=NOT_PURCHASED');
  });
});

const skip = await dbSkipReason();
const code = skip ? '' : (await liveCodes(1))[0] ?? '';

describe('palette search scoping (database)', { skip }, () => {
  const tag = randomBytes(4).toString('hex');
  let a: TestActor;
  let b: TestActor;
  const ids = { a1: '', a2: '', a3: '', b1: '' };
  let scoped: SearchUser;
  let admin: SearchUser;

  const client = async (orgId: string, name: string, archived = false): Promise<string> =>
    (await db.client.create({ data: { orgId, name, archivedAt: archived ? new Date() : null } })).id;

  const catalog = async (orgId: string, clientId: string, filename: string, rows: { name: string; mxik?: string; finding?: 'risky' | 'info' }[], createdAt = new Date()): Promise<string> => {
    const created = await db.catalog.create({
      data: { orgId, clientId, filename, rowCount: rows.length, status: 'ready', headers: ['name'], columnMap: { name: 0 }, createdAt },
    });
    for (const [rowIndex, row] of rows.entries()) {
      const item = await db.catalogItem.create({
        data: { catalogId: created.id, rowIndex, rawName: row.name, normalizedName: row.name.toLowerCase(), existingMxik: row.mxik ?? null, attrs: {} },
      });
      if (row.finding) {
        await db.finding.create({
          data: {
            itemId: item.id, type: row.finding === 'risky' ? 'MISSING' : 'NOT_PURCHASED', severity: row.finding === 'risky' ? 'high' : 'info',
            alternatives: [], reason: 'test',
          },
        });
      }
    }
    return created.id;
  };

  before(async () => {
    a = await makeOrg();
    b = await makeOrg();
    ids.a1 = await client(a.orgId, `Alfa ${tag}`);
    ids.a2 = await client(a.orgId, `Beta ${tag}`);
    ids.a3 = await client(a.orgId, `Arxiv ${tag}`, true);
    ids.b1 = await client(b.orgId, `Alfa ${tag}`);
    await catalog(a.orgId, ids.a1, `eski-${tag}.xlsx`, [{ name: `Eski ${tag} guruch`, finding: 'risky' }], new Date(Date.now() - 86_400_000));
    await catalog(a.orgId, ids.a1, `alfa-${tag}.xlsx`, [
      { name: `Guruch ${tag} alfa`, finding: 'risky' },
      { name: `Toza ${tag} alfa` },
      { name: `Un ${tag} alfa`, finding: 'info' },
      { name: `Kodli ${tag} alfa`, mxik: code },
    ]);
    await catalog(a.orgId, ids.a2, `beta-${tag}.xlsx`, [{ name: `Guruch ${tag} beta`, finding: 'risky' }]);
    await catalog(a.orgId, ids.a3, `arxiv-${tag}.xlsx`, [{ name: `Guruch ${tag} arxiv`, finding: 'risky' }]);
    await catalog(b.orgId, ids.b1, `alfa-${tag}.xlsx`, [{ name: `Guruch ${tag} begona`, finding: 'risky' }]);
    admin = { orgId: a.orgId, clientIds: null };
    scoped = { orgId: a.orgId, clientIds: [ids.a2] };
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  it('finds products across all rows of the latest ready catalogue, not only risky ones', async () => {
    const r = await search(admin, `${tag} alfa`, 'uz');
    const names = r.products.map((p) => p.name).sort();
    assert.deepEqual(names, [`Guruch ${tag} alfa`, `Kodli ${tag} alfa`, `Toza ${tag} alfa`, `Un ${tag} alfa`]);
    const byName = new Map(r.products.map((p) => [p.name, p]));
    assert.equal(byName.get(`Guruch ${tag} alfa`)?.status, 'attention');
    assert.equal(byName.get(`Toza ${tag} alfa`)?.status, 'clean');
    assert.equal(byName.get(`Un ${tag} alfa`)?.status, 'info');
    assert.equal(byName.get(`Guruch ${tag} alfa`)?.clientName, `Alfa ${tag}`);
  });

  it('ignores older catalogues and archived clients', async () => {
    const r = await search(admin, `${tag}`, 'uz');
    const names = r.products.map((p) => p.name);
    assert.ok(!names.includes(`Eski ${tag} guruch`), 'only the latest ready catalogue is searched');
    assert.ok(!names.some((n) => n.includes('arxiv')), 'archived clients are left out');
    assert.ok(!r.clients.some((c) => c.id === ids.a3));
    assert.ok(!r.catalogs.some((c) => c.filename.startsWith('arxiv-')));
  });

  it('a scoped accountant never gets another client of the same org', async () => {
    const r = await search(scoped, `Guruch ${tag}`, 'uz');
    assert.deepEqual(r.products.map((p) => p.name), [`Guruch ${tag} beta`]);
    const clients = await search(scoped, tag, 'uz');
    assert.deepEqual(clients.clients.map((c) => c.id), [ids.a2]);
    assert.deepEqual(clients.catalogs.map((c) => c.filename), [`beta-${tag}.xlsx`]);
  });

  it('never returns another organisation\'s clients, catalogues or products', async () => {
    const r = await search(admin, tag, 'uz');
    assert.ok(!r.clients.some((c) => c.id === ids.b1));
    const begona = await search(admin, `${tag} begona`, 'uz');
    assert.equal(begona.products.length, 0);
    const other = await search({ orgId: b.orgId, clientIds: null }, `${tag} alfa`, 'uz');
    assert.deepEqual(other.products, []);
  });

  it('matches products and classifier codes by a code prefix', { skip: code ? false : 'no classifier codes' }, async () => {
    const r = await search(admin, code.slice(0, 12), 'ru');
    assert.ok(r.products.some((p) => p.name === `Kodli ${tag} alfa` && p.code === code));
    assert.ok(r.codes.some((c) => c.code === code && c.name.length > 0));
    const exact = await search(admin, code, 'uz');
    assert.deepEqual(exact.codes.map((c) => c.code), [code]);
  });

  it('returns nothing for a query under two characters', async () => {
    const r = await search(admin, 'G', 'uz');
    assert.deepEqual([r.clients, r.catalogs, r.products, r.codes], [[], [], [], []]);
  });
});
