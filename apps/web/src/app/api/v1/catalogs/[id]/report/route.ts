import { db } from '@tasnivo/db';
import { PAGE, pageLimit } from '@tasnivo/domain/api/contract';
import { recordUsage } from '@tasnivo/domain/api/limits';
import { crashed, enter, failure } from '@/lib/api/respond';
import { findingOut, reportOut } from '@tasnivo/domain/api/serialize';
import { findingTypeCounts } from '@tasnivo/domain/finding-type-counts';

export const dynamic = 'force-dynamic';

const OP = 'report';

/** Status, summary and one page of findings (cursor = nextCursor of the previous page). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const entered = await enter(OP, request);
  if ('response' in entered) return entered.response;
  const { caller, reply } = entered;
  try {
    const { id } = await params;
    const catalog = await db.catalog.findFirst({
      where: { id, orgId: caller.orgId },
      select: { id: true, filename: true, clientId: true, createdAt: true, status: true, rowCount: true, progressDone: true },
    });
    if (!catalog) return reply(failure(OP, 'not_found', 'Catalogue not found.'));
    await recordUsage(caller.keyId, caller.orgId, 0);
    if (catalog.status !== 'ready') return reply({ status: 200, body: reportOut({ catalog, summary: null, findings: [], nextCursor: null }) });

    const url = new URL(request.url);
    const limit = pageLimit(url.searchParams.get('limit'), PAGE.findings);
    const cursor = url.searchParams.get('cursor');
    const where = { item: { catalogId: catalog.id } };
    if (cursor && !(await db.finding.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) {
      return reply(failure(OP, 'invalid_request', 'Unknown cursor: pass nextCursor from the previous page.'));
    }
    const [byType, rows] = await Promise.all([
      findingTypeCounts(catalog.id),
      db.finding.findMany({
        where, take: limit + 1, orderBy: [{ item: { rowIndex: 'asc' } }, { id: 'asc' }],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { item: { select: { rowIndex: true, rawName: true, barcode: true, unit: true, existingMxik: true } } },
      }),
    ]);
    const page = rows.slice(0, limit);
    return reply({
      status: 200,
      body: reportOut({
        catalog,
        summary: Object.fromEntries(byType.map((g) => [g.type, g.count])),
        findings: page.map(findingOut),
        nextCursor: rows.length > limit ? page[page.length - 1]?.id ?? null : null,
      }),
    });
  } catch (error) {
    return crashed(OP, error, reply);
  }
}
