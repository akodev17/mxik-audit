import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { recordUsage } from '@/lib/api/limits';
import { apiError, enter } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/** Status, summary and one page of findings (cursor = the last finding id of the previous page). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const entered = await enter(request);
  if ('response' in entered) return entered.response;
  const { caller } = entered;

  const { id } = await params;
  const catalog = await db.catalog.findFirst({ where: { id, orgId: caller.orgId }, select: { id: true, status: true, rowCount: true, progressDone: true, filename: true, createdAt: true, auditError: true } });
  if (!catalog) return apiError('not_found', 'Catalogue not found.');
  await recordUsage(caller.keyId, caller.orgId, 0);

  const base = { id: catalog.id, filename: catalog.filename, createdAt: catalog.createdAt, status: catalog.status, rows: catalog.rowCount, progress: { done: catalog.progressDone, total: catalog.rowCount } };
  if (catalog.status !== 'ready') return NextResponse.json({ ...base, ...(catalog.auditError ? { error: catalog.auditError } : {}) });

  const url = new URL(request.url);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));
  const cursor = url.searchParams.get('cursor');
  const where = { item: { catalogId: catalog.id } };
  const [byType, rows] = await Promise.all([
    db.finding.groupBy({ by: ['type'], where, _count: { _all: true } }),
    db.finding.findMany({
      where, take: limit + 1, orderBy: [{ item: { rowIndex: 'asc' } }, { id: 'asc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { item: { select: { rowIndex: true, rawName: true, barcode: true, unit: true, existingMxik: true } } },
    }),
  ]);
  const page = rows.slice(0, limit);
  return NextResponse.json({
    ...base,
    summary: Object.fromEntries(byType.map((g) => [g.type, g._count._all])),
    findings: page.map((f) => ({
      id: f.id, row: f.item.rowIndex + 1, name: f.item.rawName, barcode: f.item.barcode, unit: f.item.unit, currentMxik: f.item.existingMxik,
      type: f.type, severity: f.severity, suggestedMxik: f.suggestedMxik, confidence: f.confidence, reason: f.reason, decision: f.decision, chosenMxik: f.chosenMxik,
    })),
    nextCursor: rows.length > limit ? page[page.length - 1]?.id ?? null : null,
  });
}
