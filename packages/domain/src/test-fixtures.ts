// Database fixtures for integration tests. Every org created here has a unique
// "test-" name and is deleted afterwards (cascade), so the tests can run
// against the development database without leaving anything behind.
import { randomBytes } from 'node:crypto';
import type { OrgKind } from '@prisma/client';
import { db } from './db.js';

/** Null when the database or the classifier is not there; tests then skip. */
export async function dbSkipReason(): Promise<string | false> {
  try {
    const rows = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT 1 FROM mxik_code LIMIT 10) s`;
    return Number(rows[0]?.n ?? 0) >= 10 ? false : 'classifier not loaded';
  } catch {
    return 'database not reachable';
  }
}

export async function liveCodes(n: number): Promise<string[]> {
  const rows = await db.$queryRaw<{ code: string }[]>`
    SELECT code FROM mxik_code WHERE "retiredAt" IS NULL ORDER BY code LIMIT ${n}`;
  return rows.map((r) => r.code.trim());
}

export type TestActor = { orgId: string; userId: string };

export async function makeOrg(kind: OrgKind = 'customer', expiresAt?: Date): Promise<TestActor> {
  const tag = randomBytes(5).toString('hex');
  const org = await db.organization.create({ data: { name: `test-${tag}`, kind, expiresAt: expiresAt ?? null } });
  const user = await db.user.create({ data: { orgId: org.id, email: `test-${tag}@test.local`, passwordHash: 'x' } });
  return { orgId: org.id, userId: user.id };
}

export type TestRow = { rawName: string; unit?: string; suggestedMxik: string | null; confidence: number | null };

export async function makeCatalog(orgId: string, rows: TestRow[]): Promise<{ catalogId: string; findingIds: string[] }> {
  const catalog = await db.catalog.create({
    data: {
      orgId, filename: 'test.xlsx', rowCount: rows.length, status: 'ready',
      headers: ['name', 'unit'], columnMap: { name: 0, barcode: -1, mxik: -1, unit: 1, price: -1 },
    },
  });
  const findingIds: string[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const item = await db.catalogItem.create({
      data: {
        catalogId: catalog.id, rowIndex, rawName: row.rawName, normalizedName: '', unit: row.unit ?? null,
        attrs: { original: [row.rawName, row.unit ?? ''] },
      },
    });
    const finding = await db.finding.create({
      data: {
        itemId: item.id, type: 'MISSING', severity: 'high', suggestedMxik: row.suggestedMxik,
        confidence: row.confidence, alternatives: [], reason: 'test',
      },
    });
    findingIds.push(finding.id);
  }
  return { catalogId: catalog.id, findingIds };
}

export async function dropOrgs(ids: readonly string[]): Promise<void> {
  await db.$executeRaw`DELETE FROM rerank_cache WHERE scope = ANY(${[...ids]})`;
  await db.organization.deleteMany({ where: { id: { in: [...ids] } } });
}
