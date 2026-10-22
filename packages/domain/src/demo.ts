// Demo mode. `npm run seed:demo` builds one audited template org; every visitor
// gets a fresh copy of it in a throwaway org, so demos never see each other's
// clicks, never see a real org, and reset by simply starting again. Copies
// expire and are removed by `npm run purge:expired`.
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { cache } from 'react';
import { db } from './db.js';
import { demoTtlHours } from './demo-config.js';
import { hashPassword } from './password.js';

export const DEMO_ORG_NAME = 'Demo Savdo MChJ';

export type DemoSession = { orgId: string; userId: string; email: string };

/** Copies the template's latest ready catalogue, findings and audit summary into a new demo org. */
export async function startDemoSession(now = new Date()): Promise<DemoSession | null> {
  const template = await db.organization.findFirst({
    where: { kind: 'demo_template' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, columnMap: true },
  });
  if (!template) return null;
  const catalog = await db.catalog.findFirst({
    where: { orgId: template.id, status: 'ready' },
    orderBy: { createdAt: 'desc' },
    include: { items: { include: { findings: true }, orderBy: { rowIndex: 'asc' } } },
  });
  if (!catalog) return null;
  const audited = await db.auditEvent.findFirst({
    where: { orgId: template.id, action: 'catalog.audited', targetId: catalog.id },
    orderBy: { createdAt: 'desc' },
    select: { payload: true },
  });

  const email = `demo-${randomBytes(6).toString('hex')}@demo.mxik.local`;
  // Nobody signs in with this; the demo button creates the session directly.
  const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
  const expiresAt = new Date(now.getTime() + demoTtlHours() * 3_600_000);

  return db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: DEMO_ORG_NAME, kind: 'demo', expiresAt, columnMap: template.columnMap ?? undefined },
    });
    const user = await tx.user.create({ data: { orgId: org.id, email, passwordHash } });
    const copy = await tx.catalog.create({
      data: {
        orgId: org.id, filename: catalog.filename, rowCount: catalog.rowCount, status: 'ready',
        headers: catalog.headers, columnMap: catalog.columnMap ?? {},
      },
    });
    const items = await tx.catalogItem.createManyAndReturn({
      data: catalog.items.map((i) => ({
        catalogId: copy.id, rowIndex: i.rowIndex, rawName: i.rawName, normalizedName: i.normalizedName,
        barcode: i.barcode, existingMxik: i.existingMxik, unit: i.unit, price: i.price,
        attrs: i.attrs ?? {}, markingRequired: i.markingRequired,
      })),
      select: { id: true, rowIndex: true },
    });
    const idByRow = new Map(items.map((i) => [i.rowIndex, i.id]));
    // Copies start undecided, whatever happened to the template.
    const findings: Prisma.FindingCreateManyInput[] = catalog.items.flatMap((i) => i.findings.map((f) => ({
      itemId: idByRow.get(i.rowIndex) ?? '',
      type: f.type, severity: f.severity, suggestedMxik: f.suggestedMxik, confidence: f.confidence,
      alternatives: f.alternatives ?? [], reason: f.reason, wasRetired: f.wasRetired,
      evidence: f.evidence ?? undefined,
    })));
    if (findings.length > 0) await tx.finding.createMany({ data: findings });
    await tx.auditEvent.create({
      data: {
        orgId: org.id, actorId: user.id, action: 'catalog.audited', targetId: copy.id,
        payload: audited?.payload ?? {},
      },
    });
    await tx.auditEvent.create({ data: { orgId: org.id, actorId: user.id, action: 'demo.started', payload: {} } });
    // Outlives the demo org, which is purged after a day: the traction count.
    await tx.demoVisit.create({ data: {} });
    return { orgId: org.id, userId: user.id, email };
  }, { timeout: 60_000 });
}

/** Once per render (React cache); server actions and route handlers read it each time. */
export const isDemoOrg = cache(async (orgId: string): Promise<boolean> => {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { kind: true } });
  return org?.kind === 'demo';
});

/** Deletes expired demo copies with everything in them. Never touches customer orgs. */
export async function purgeExpiredDemos(now = new Date()): Promise<number> {
  const expired = await db.organization.findMany({
    where: { kind: 'demo', expiresAt: { lt: now } },
    select: { id: true },
  });
  if (expired.length === 0) return 0;
  const ids = expired.map((o) => o.id);
  await db.$executeRaw`DELETE FROM rerank_cache WHERE scope = ANY(${ids})`;
  const removed = await db.organization.deleteMany({ where: { id: { in: ids }, kind: 'demo' } });
  return removed.count;
}
