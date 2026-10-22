// The app with a Prisma client older than the database. Every read that returns
// a finding's type fails the way Prisma fails on an enum value it was generated
// without, and every raw read reports a type no client knows. The catalogue
// list, the dashboard and the workspace must still load, counting those
// findings as OTHER. Inserts nothing: it reads an audited catalogue the
// database already holds, and skips when there is none.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { FindingType, Prisma, PrismaClient } from '@prisma/client';
import { findingTypeFallback, isUnknownFindingType, withoutFindingType } from './finding-type-extension.js';
import { RISKY_FINDING } from './risk.js';

const FUTURE = 'FUTURE_CHECK';
const READS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow']);
const KNOWN: ReadonlySet<unknown> = new Set(Object.values(FindingType));

/** Raw reads: a finding type comes back as a value no client knows. */
const futureText = Prisma.defineExtension({
  name: 'stale-client-raw',
  query: {
    async $queryRaw({ args, query }) {
      const rows: unknown = await query(args);
      if (!Array.isArray(rows)) return rows;
      return rows.map((r: unknown) => (r && typeof r === 'object' && KNOWN.has((r as { type?: unknown }).type) ? { ...r, type: FUTURE } : r));
    },
  },
});

/** Model reads: any read that returns a finding's type fails, with Prisma's message. */
const enumFailure = Prisma.defineExtension({
  name: 'stale-client-reads',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (READS.has(operation) && withoutFindingType(model, args ?? {}).needs.length > 0) {
          throw new Error(`Invalid \`prisma.${model}.${operation}()\` invocation:\n\nValue '${FUTURE}' not found in enum 'FindingType'`);
        }
        return query(args);
      },
    },
  },
});

// Only a stale client, to show the simulation fails the way the real one does.
const bare = new PrismaClient().$extends(enumFailure);
// What every module gets as `db` in this process (src/lib/db.ts reuses globalThis.prisma outside
// production). An extension added earlier wraps the ones added after it, so the fallback catches
// the failing read, and its text read goes through the fake value.
(globalThis as { prisma?: unknown }).prisma = new PrismaClient().$extends(futureText).$extends(findingTypeFallback).$extends(enumFailure);

const { db } = await import('./db.js');
const { dbSkipReason } = await import('./test-fixtures.js');
const { catalogList } = await import('./catalogs.js');
const { dashboard } = await import('./dashboard.js');
const { findingTypeCounts } = await import('./finding-type-counts.js');
const { decodeCursor, readFilter, workspacePageIds, workspaceSummary } = await import('./workspace.js');
const { gridRows } = await import('./workspace-rows.js');

async function auditedCatalogue() {
  return db.catalog.findFirst({
    where: { status: 'ready', org: { name: { not: { startsWith: 'test-' } } }, items: { some: { findings: { some: RISKY_FINDING } } } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, orgId: true, rowCount: true },
  });
}

const dbSkip = await dbSkipReason();
const catalog = dbSkip ? null : await auditedCatalogue();
const skip = dbSkip || (catalog ? false : 'no audited catalogue with findings in the database');

describe('a finding type the Prisma client does not know (database, read-only)', { skip }, () => {
  const c = catalog!;
  const user = { orgId: c?.orgId ?? '', role: 'admin', clientIds: null };

  after(async () => {
    await Promise.all([db.$disconnect(), bare.$disconnect()]);
  });

  it('fails without the fallback, as Prisma does', async () => {
    await assert.rejects(bare.finding.findFirst({ where: { item: { catalogId: c.id } } }), (e) => isUnknownFindingType(e));
  });

  it('lists the catalogues', async () => {
    const { items } = await catalogList(user, null, 0);
    assert.ok(items.some((i) => i.id === c.id));
  });

  it('builds the dashboard, the unknown type counted as OTHER', async () => {
    const data = await dashboard(user, null);
    assert.ok(data.byType.every((t) => t.type === 'OTHER'), JSON.stringify(data.byType));
  });

  it('counts the catalogue’s findings under OTHER', async () => {
    const counts = await findingTypeCounts(c.id);
    assert.equal(counts.length, 1);
    assert.equal(counts[0]?.type, 'OTHER');
    assert.ok((counts[0]?.count ?? 0) > 0);
    const summary = await workspaceSummary(c.id, c.rowCount);
    assert.deepEqual(Object.keys(summary.byType), ['OTHER']);
  });

  it('opens the workspace rows, each finding typed OTHER', async () => {
    const { ids } = await workspacePageIds(c.id, readFilter({ dec: 'all' }), decodeCursor(null), 50);
    const rows = await gridRows(c.orgId, c.id, ids);
    assert.ok(ids.length > 0);
    assert.equal(rows.length, ids.length);
    assert.ok(rows.every((r) => r.type === 'OTHER'));
  });

  it('reads a finding with its relations, the type filled in and nothing else lost', async () => {
    const f = await db.finding.findFirst({ where: { item: { catalogId: c.id } }, include: { item: { select: { catalogId: true } } } });
    assert.equal(f?.type, 'OTHER');
    assert.equal(f?.item.catalogId, c.id);
    assert.equal(typeof f?.id, 'string');
  });
});
