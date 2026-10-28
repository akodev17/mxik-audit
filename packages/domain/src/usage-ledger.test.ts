import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { applyMapping, storeCatalog } from './catalog-import.js';
import { deleteCatalog } from './catalogs.js';
import { archiveClient, deleteClient, restoreClient } from './client-lifecycle.js';
import { defaultClient } from './clients.js';
import type { ColumnMap } from './column-map.js';
import { makeClient } from './firm-test-fixtures.js';
import { acceptInvite, createInvite } from './invites.js';
import { gate, usageOf } from './plan.js';
import { parseUpload } from './spreadsheet.js';
import { revokeTeamInvite } from './team-members.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';
import { consumeRows, monthStart, OverAllowance, rowsUsed } from './usage-ledger.js';

const MAP: ColumnMap = { name: 0, barcode: -1, mxik: -1, unit: 1, price: -1, tnved: -1, sales: -1 };
const TRIAL_ROWS = 5_000;
const csv = (rows: number): string => ['Nomi;Birlik', ...Array.from({ length: rows }, (_, i) => `Mahsulot ${i};dona`)].join('\n');

describe('usage ledger periods', () => {
  it('counts in the UTC calendar month', () => {
    assert.equal(monthStart(new Date('2026-10-31T23:59:59Z')).toISOString(), '2026-10-01T00:00:00.000Z');
    assert.equal(monthStart(new Date('2026-11-01T00:00:00Z')).toISOString(), '2026-11-01T00:00:00.000Z');
  });
});

const skip = await dbSkipReason();

describe('monthly row usage survives deletion (database)', { skip }, () => {
  const orgs: string[] = [];
  let a: TestActor;
  let clientId = '';

  const trialOrg = async (): Promise<{ actor: TestActor; clientId: string }> => {
    const actor = await makeOrg();
    orgs.push(actor.orgId);
    await db.organization.update({ where: { id: actor.orgId }, data: { trialEndsAt: new Date(Date.now() + 14 * 86_400_000) } });
    return { actor, clientId: (await defaultClient(actor.orgId)).id };
  };
  const preview = async (actor: TestActor, client: string, rows: number): Promise<string> => {
    const parsed = await parseUpload(Buffer.from(csv(rows), 'utf8'), 'k.csv');
    return (await storeCatalog({ orgId: actor.orgId, userId: actor.userId, clientId: client, filename: 'k.csv', parsed, mapping: MAP })).catalogId;
  };
  const commit = async (rows: number, actor = a, client = clientId): Promise<string> => {
    const catalogId = await preview(actor, client, rows);
    assert.deepEqual(await applyMapping(actor.orgId, catalogId, MAP), { rows });
    return catalogId;
  };

  before(async () => {
    ({ actor: a, clientId } = await trialOrg());
  });
  after(async () => {
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('a commit writes one ledger entry for the catalogue, and usageOf reads the ledger', async () => {
    const catalogId = await commit(40);
    const entries = await db.usageLedger.findMany({ where: { orgId: a.orgId } });
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.catalogId, catalogId);
    assert.equal(entries[0]?.key, 'rowsPerMonth');
    assert.equal(entries[0]?.amount, 40);
    assert.equal(entries[0]?.reason, 'catalog.committed');
    assert.equal(entries[0]?.period.toISOString(), monthStart(new Date()).toISOString());
    assert.equal((await usageOf(a.orgId)).rowsPerMonth, 40);
  });

  it('deleting a committed catalogue does not give its rows back', async () => {
    const before = (await usageOf(a.orgId)).rowsPerMonth;
    const catalogId = await commit(25);
    assert.equal((await usageOf(a.orgId)).rowsPerMonth, before + 25);
    assert.ok((await deleteCatalog({ ...a, clientIds: null }, catalogId)).ok);
    assert.equal((await usageOf(a.orgId)).rowsPerMonth, before + 25, 'the trial allowance stays consumed');
    const kept = await db.usageLedger.findFirst({ where: { catalogId } });
    assert.equal(kept?.amount, 25, 'the entry outlives its catalogue');
  });

  it('upload, delete, upload again cannot pass the trial cap', async () => {
    const room = TRIAL_ROWS - (await usageOf(a.orgId)).rowsPerMonth;
    assert.deepEqual(await gate(a.orgId, 'rowsPerMonth', room), { ok: true });
    const big = await commit(room);
    assert.ok((await deleteCatalog({ ...a, clientIds: null }, big)).ok);
    assert.deepEqual(await gate(a.orgId, 'rowsPerMonth', 1), { ok: false, reason: 'rowsPerMonth' });
    // Even past the callers' gate, the commit itself refuses and leaves the upload as a preview.
    const late = await preview(a, clientId, 1);
    assert.deepEqual(await applyMapping(a.orgId, late, MAP), { error: 'over_allowance' });
    assert.equal((await db.catalog.findUniqueOrThrow({ where: { id: late } })).status, 'uploaded');
    assert.equal(await db.usageLedger.count({ where: { catalogId: late } }), 0);
    assert.equal((await usageOf(a.orgId)).rowsPerMonth, TRIAL_ROWS);
  });

  it('a catalogue consumes once, however often its rows are recorded', async () => {
    const { actor, clientId: client } = await trialOrg();
    const catalogId = await commit(10, actor, client);
    await db.$transaction((tx) => consumeRows(tx, { orgId: actor.orgId, catalogId, amount: 10, cap: TRIAL_ROWS }));
    // Already recorded, so not refused even with no room left.
    await db.$transaction((tx) => consumeRows(tx, { orgId: actor.orgId, catalogId, amount: 10, cap: 0 }));
    assert.equal(await rowsUsed(actor.orgId), 10);
    assert.equal(await db.usageLedger.count({ where: { catalogId } }), 1);
  });

  it('concurrent commits cannot pass the cap together', async () => {
    const { actor, clientId: client } = await trialOrg();
    const [x, y] = await Promise.all([preview(actor, client, 3_000), preview(actor, client, 3_000)]);
    const results = await Promise.all([applyMapping(actor.orgId, x, MAP), applyMapping(actor.orgId, y, MAP)]);
    assert.deepEqual(results.map((r) => ('rows' in r ? 'ok' : r.error)).sort(), ['ok', 'over_allowance']);
    assert.equal(await rowsUsed(actor.orgId), 3_000);
  });

  it('counts only the current month, and an uncapped plan is never refused', async () => {
    const { actor, clientId: client } = await trialOrg();
    const catalogId = await commit(7, actor, client);
    const nextMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 2));
    assert.equal(await rowsUsed(actor.orgId, nextMonth), 0);
    await assert.rejects(
      db.$transaction((tx) => consumeRows(tx, { orgId: actor.orgId, catalogId: `${catalogId}-other`, amount: TRIAL_ROWS, cap: TRIAL_ROWS })),
      OverAllowance,
    );
    await db.$transaction((tx) => consumeRows(tx, { orgId: actor.orgId, catalogId: `${catalogId}-other`, amount: TRIAL_ROWS, cap: null }));
    assert.equal(await rowsUsed(actor.orgId), 7 + TRIAL_ROWS);
  });
});

describe('usage ledger backfill (database)', { skip }, () => {
  const orgs: string[] = [];
  after(async () => {
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('the migration counts exactly what usageOf used to: this month\'s catalogues past "uploaded"', async () => {
    const sql = readFileSync(new URL('../../db/prisma/migrations/20261027100000_usage_ledger/migration.sql', import.meta.url), 'utf8');
    const backfill = /INSERT INTO "usage_ledger"[\s\S]*?;/.exec(sql)?.[0];
    assert.ok(backfill, 'the migration has a backfill');

    const actor = await makeOrg();
    orgs.push(actor.orgId);
    const clientId = (await defaultClient(actor.orgId)).id;
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    const make = (status: 'uploaded' | 'analyzing' | 'ready' | 'failed', rowCount: number, createdAt = now) =>
      db.catalog.create({ data: { orgId: actor.orgId, clientId, filename: 'x.csv', rowCount, status, createdAt, headers: ['Nomi'], columnMap: MAP }, select: { id: true } });
    await make('ready', 100);
    await make('failed', 20);
    await make('analyzing', 3);
    await make('uploaded', 1_000);
    await make('ready', 500, lastMonth);
    const old = (await db.catalog.aggregate({
      where: { orgId: actor.orgId, createdAt: { gte: monthStart(now) }, status: { not: 'uploaded' } }, _sum: { rowCount: true },
    }))._sum.rowCount;

    // Run on the development database inside a transaction that is rolled back: nothing stays.
    class Rollback extends Error {}
    let seen: { amount: number; reason: string; period: Date }[] = [];
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(backfill);
      await tx.$executeRawUnsafe(backfill); // idempotent
      seen = await tx.usageLedger.findMany({ where: { orgId: actor.orgId }, select: { amount: true, reason: true, period: true } });
      throw new Rollback();
    }).catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
    assert.equal(seen.length, 3);
    assert.equal(seen.reduce((s, e) => s + e.amount, 0), old);
    assert.equal(old, 123);
    assert.ok(seen.every((e) => e.reason === 'backfill' && e.period.getTime() === monthStart(now).getTime()));
    assert.equal(await db.usageLedger.count({ where: { orgId: actor.orgId } }), 0, 'rolled back');
  });
});

// Clients and seats are standing capacity (how many exist now), not consumption: freeing one by a
// delete is meant. What costs processing, the rows, stays in the ledger whatever is deleted.
describe('clients and seats cannot be recycled into more processing (database)', { skip }, () => {
  const orgs: string[] = [];
  let a: TestActor & { role: 'admin' };
  before(async () => {
    a = { ...(await makeOrg()), role: 'admin' };
    orgs.push(a.orgId);
    await db.organization.update({ where: { id: a.orgId }, data: { trialEndsAt: new Date(Date.now() + 14 * 86_400_000) } });
  });
  after(async () => {
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('archived clients still count; deleting one frees its slot but not the rows its catalogues used', async () => {
    await defaultClient(a.orgId);
    const kept = await makeClient(a.orgId, 'Ikkinchi');
    const gone = await makeClient(a.orgId, 'Uchinchi');
    assert.deepEqual(await gate(a.orgId, 'clients'), { ok: false, reason: 'clients' }, 'trial: 3 clients');
    assert.ok((await archiveClient(a, kept)).ok);
    assert.deepEqual(await gate(a.orgId, 'clients'), { ok: false, reason: 'clients' }, 'archiving frees nothing');
    assert.ok((await restoreClient(a, kept)).ok);
    assert.equal((await usageOf(a.orgId)).clients, 3);

    const parsed = await parseUpload(Buffer.from(csv(30), 'utf8'), 'k.csv');
    const { catalogId } = await storeCatalog({ orgId: a.orgId, userId: a.userId, clientId: gone, filename: 'k.csv', parsed, mapping: MAP });
    assert.deepEqual(await applyMapping(a.orgId, catalogId, MAP), { rows: 30 });
    assert.ok((await deleteClient(a, gone, 'Uchinchi')).ok);
    const usage = await usageOf(a.orgId);
    assert.equal(usage.clients, 2);
    assert.equal(usage.rowsPerMonth, 30, 'the deleted client\'s rows stay consumed');
  });

  it('an open invite holds a seat; accepting it keeps the count, revoking frees it', async () => {
    assert.equal((await usageOf(a.orgId)).seats, 1);
    const to = `test-${randomBytes(5).toString('hex')}@example.uz`;
    const { url } = await createInvite(a, { email: to, role: 'accountant', clientIds: [] });
    assert.deepEqual(await gate(a.orgId, 'seats'), { ok: false, reason: 'seats' }, 'trial: 2 seats');
    assert.ok((await acceptInvite(url.split('/invite/')[1] ?? '', to, 'password-123')).ok);
    assert.deepEqual(await gate(a.orgId, 'seats'), { ok: false, reason: 'seats' });
    assert.equal((await usageOf(a.orgId)).seats, 2);

    await db.user.deleteMany({ where: { orgId: a.orgId, email: to } });
    await createInvite(a, { email: null, role: 'viewer', clientIds: [] });
    const open = await db.invite.findFirstOrThrow({ where: { orgId: a.orgId, usedAt: null } });
    assert.ok((await revokeTeamInvite(a, open.id)).ok);
    assert.equal((await usageOf(a.orgId)).seats, 1);
  });
});
