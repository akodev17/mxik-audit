// Fixtures for the firm-area integration tests (clients, people, catalogues
// with chosen findings). Everything hangs off orgs made by makeOrg, so
// dropOrgs removes it all.
import { randomBytes } from 'node:crypto';
import type { Decision, FindingType, Severity, UserRole } from '@prisma/client';
import { db } from '@tasnivo/db';

const tag = (): string => randomBytes(4).toString('hex');

export async function makeClient(orgId: string, name: string, opts: { archived?: boolean } = {}): Promise<string> {
  const c = await db.client.create({ data: { orgId, name, archivedAt: opts.archived ? new Date() : null }, select: { id: true } });
  return c.id;
}

export type Person = { userId: string; orgId: string; role: UserRole; clientIds: string[] | null; email: string };

/** A member with this role; clientIds become assignments (none = sees every client, as in session.ts). */
export async function makePerson(orgId: string, role: UserRole, clientIds: string[] = []): Promise<Person> {
  const email = `test-${tag()}@test.local`;
  // Confirmed address: an unconfirmed member reaches only the code step (AccessGuard).
  const user = await db.user.create({ data: { orgId, email, passwordHash: 'x', role, emailVerifiedAt: new Date() }, select: { id: true } });
  if (clientIds.length > 0) await db.clientAssignment.createMany({ data: clientIds.map((clientId) => ({ userId: user.id, clientId })) });
  return { userId: user.id, orgId, role, email, clientIds: role === 'admin' || clientIds.length === 0 ? null : clientIds };
}

export type FindingSpec = { type?: FindingType; severity?: Severity; decision?: Decision; snapshotId?: number; flag?: string };
export type RowSpec = { name: string; findings: FindingSpec[] };

/** A catalogue of one client with rows and the findings each row should carry. */
export async function makeClientCatalog(
  orgId: string, clientId: string, rows: RowSpec[],
  opts: { status?: 'uploaded' | 'ready'; createdAt?: Date; previousId?: string; filename?: string } = {},
): Promise<{ catalogId: string; findingIds: string[][] }> {
  const catalog = await db.catalog.create({
    data: {
      orgId, clientId, filename: opts.filename ?? `test-${tag()}.xlsx`, rowCount: rows.length, status: opts.status ?? 'ready',
      headers: ['name'], columnMap: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1 },
      createdAt: opts.createdAt, previousId: opts.previousId ?? null,
    },
    select: { id: true },
  });
  const findingIds: string[][] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const item = await db.catalogItem.create({
      data: { catalogId: catalog.id, rowIndex, rawName: row.name, normalizedName: '', attrs: { original: [row.name] } },
      select: { id: true },
    });
    const ids: string[] = [];
    for (const f of row.findings) {
      const finding = await db.finding.create({
        data: {
          itemId: item.id, type: f.type ?? 'MISSING', severity: f.severity ?? 'high', decision: f.decision ?? 'pending',
          snapshotId: f.snapshotId ?? null, flag: f.flag ?? null, suggestedMxik: null, confidence: null, alternatives: [], reason: 'test',
        },
        select: { id: true },
      });
      ids.push(finding.id);
    }
    findingIds.push(ids);
  }
  return { catalogId: catalog.id, findingIds };
}
