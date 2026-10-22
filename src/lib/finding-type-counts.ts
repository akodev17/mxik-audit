// Findings of a catalogue by type, counted in SQL with the type read as text.
// A Prisma groupBy on the enum column fails outright when the database holds a
// value the generated client does not know; this counts it as OTHER instead.
import { Prisma } from '@prisma/client';
import { db } from './db.js';
import { mergeTypeCounts, type FindingTypeCount } from './finding-type.js';
import { RISKY_SEVERITIES } from './risk.js';

/** Every finding of the catalogue, or only the risky ones (severity high or medium). */
export async function findingTypeCounts(catalogId: string, opts: { risky?: boolean } = {}): Promise<FindingTypeCount[]> {
  const risky = opts.risky ? Prisma.sql`AND f.severity::text IN (${Prisma.join([...RISKY_SEVERITIES])})` : Prisma.empty;
  const rows = await db.$queryRaw<{ type: string; n: number }[]>(Prisma.sql`
    SELECT f.type::text AS type, count(*)::int AS n
    FROM finding f JOIN catalog_item ci ON ci.id = f."itemId"
    WHERE ci."catalogId" = ${catalogId} ${risky}
    GROUP BY 1`);
  return mergeTypeCounts(rows.map((r) => ({ type: r.type, count: r.n })));
}
