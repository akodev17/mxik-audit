// Traction numbers for the admin page. Counts real customers only: demo
// copies, the demo template and our own internal orgs (seed, perf, tests) are
// excluded, so the figures can go into an accelerator application as they are.
import { Prisma } from '@prisma/client';
import { db } from './db.js';

export type Traction = {
  generatedAt: Date;
  orgs: { customers: number; newLast30Days: number };
  catalogs: { total: number; last30Days: number; byStatus: Record<string, number> };
  rows: { audited: number; risky: number };
  findingsByType: Record<string, number>;
  decisions: { accepted: number; edited: number; rejected: number; pending: number; bulkAcceptedRows: number; undone: number };
  review: { medianSecondsPerRow: number | null; sampleIntervals: number };
  demo: { sessions: number; last30Days: number };
  leads: { total: number; withFile: number; last30Days: number };
};

type DecisionEvent = { actorId: string | null; catalogId: string | null; at: Date };

/** Above this, the reviewer took a break; the gap says nothing about review speed. */
export const REVIEW_BREAK_MS = 10 * 60_000;

/**
 * Median seconds between one reviewer's consecutive single decisions within
 * one catalogue — the time a row actually takes to review. Bulk accepts are
 * not decisions about one row and are counted separately.
 */
export function medianReviewSeconds(events: readonly DecisionEvent[], maxGapMs = REVIEW_BREAK_MS): { median: number | null; samples: number } {
  const sorted = [...events].sort((a, b) =>
    (a.actorId ?? '').localeCompare(b.actorId ?? '')
    || (a.catalogId ?? '').localeCompare(b.catalogId ?? '')
    || a.at.getTime() - b.at.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!prev || !cur || prev.actorId !== cur.actorId || prev.catalogId !== cur.catalogId) continue;
    const gap = cur.at.getTime() - prev.at.getTime();
    if (gap > 0 && gap <= maxGapMs) gaps.push(gap / 1000);
  }
  if (gaps.length === 0) return { median: null, samples: 0 };
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 1 ? gaps[mid] ?? 0 : ((gaps[mid - 1] ?? 0) + (gaps[mid] ?? 0)) / 2;
  return { median: Number(median.toFixed(1)), samples: gaps.length };
}

const n = (v: unknown): number => Number(v ?? 0);

/** `orgIds` narrows everything to those orgs; tests use it to stay isolated. */
export async function tractionMetrics(orgIds?: readonly string[]): Promise<Traction> {
  const scope = orgIds ? Prisma.sql`AND o.id = ANY(${[...orgIds]})` : Prisma.empty;
  const customer = Prisma.sql`o.kind = 'customer'::org_kind ${scope}`;

  const [orgs] = await db.$queryRaw<{ total: bigint; recent: bigint }[]>`
    SELECT count(*) AS total, count(*) FILTER (WHERE o."createdAt" > now() - interval '30 days') AS recent
    FROM organization o WHERE ${customer}`;

  const catalogs = await db.$queryRaw<{ status: string; count: bigint; recent: bigint; rows: bigint }[]>`
    SELECT c.status::text AS status, count(*) AS count,
           count(*) FILTER (WHERE c."createdAt" > now() - interval '30 days') AS recent,
           coalesce(sum(c."rowCount"), 0) AS rows
    FROM catalog c JOIN organization o ON o.id = c."orgId" WHERE ${customer} GROUP BY 1`;

  const [risky] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(DISTINCT i.id) AS n
    FROM finding f JOIN catalog_item i ON i.id = f."itemId" JOIN catalog c ON c.id = i."catalogId"
    JOIN organization o ON o.id = c."orgId" WHERE ${customer}`;

  const byType = await db.$queryRaw<{ type: string; n: bigint }[]>`
    SELECT f.type::text AS type, count(*) AS n
    FROM finding f JOIN catalog_item i ON i.id = f."itemId" JOIN catalog c ON c.id = i."catalogId"
    JOIN organization o ON o.id = c."orgId" WHERE ${customer} GROUP BY 1`;

  const decisions = await db.$queryRaw<{ decision: string; edited: boolean; n: bigint }[]>`
    SELECT f.decision::text AS decision,
           (f.decision = 'accepted'::decision AND f."chosenMxik" IS DISTINCT FROM f."suggestedMxik") AS edited,
           count(*) AS n
    FROM finding f JOIN catalog_item i ON i.id = f."itemId" JOIN catalog c ON c.id = i."catalogId"
    JOIN organization o ON o.id = c."orgId" WHERE ${customer} GROUP BY 1, 2`;

  const [events] = await db.$queryRaw<{ bulk: bigint; undone: bigint }[]>`
    SELECT coalesce(sum((e.payload->>'count')::int) FILTER (WHERE e.action = 'finding.bulk_accepted'), 0) AS bulk,
           count(*) FILTER (WHERE e.action = 'finding.undone') AS undone
    FROM audit_event e JOIN organization o ON o.id = e."orgId" WHERE ${customer}`;

  const singles = await db.$queryRaw<{ actorId: string | null; catalogId: string | null; at: Date }[]>`
    SELECT e."actorId", e.payload->>'catalogId' AS "catalogId", e."createdAt" AS at
    FROM audit_event e JOIN organization o ON o.id = e."orgId"
    WHERE ${customer} AND e.action IN ('finding.accepted', 'finding.rejected')
    ORDER BY e."createdAt" DESC LIMIT 50000`;

  // Demo sessions and leads belong to no org; a scoped (test) run leaves them out.
  const [demo] = orgIds ? [{ total: 0n, recent: 0n }] : await db.$queryRaw<{ total: bigint; recent: bigint }[]>`
    SELECT count(*) AS total, count(*) FILTER (WHERE "createdAt" > now() - interval '30 days') AS recent FROM demo_visit`;
  const [leads] = orgIds ? [{ total: 0n, files: 0n, recent: 0n }] : await db.$queryRaw<{ total: bigint; files: bigint; recent: bigint }[]>`
    SELECT count(*) AS total, count(*) FILTER (WHERE "fileBytes" IS NOT NULL) AS files,
           count(*) FILTER (WHERE "createdAt" > now() - interval '30 days') AS recent FROM lead`;

  const count = (decision: string, edited: boolean): number =>
    decisions.filter((d) => d.decision === decision && d.edited === edited).reduce((s, d) => s + n(d.n), 0);
  const review = medianReviewSeconds(singles);

  return {
    generatedAt: new Date(),
    orgs: { customers: n(orgs?.total), newLast30Days: n(orgs?.recent) },
    catalogs: {
      total: catalogs.reduce((s, c) => s + n(c.count), 0),
      last30Days: catalogs.reduce((s, c) => s + n(c.recent), 0),
      byStatus: Object.fromEntries(catalogs.map((c) => [c.status, n(c.count)])),
    },
    rows: { audited: n(catalogs.find((c) => c.status === 'ready')?.rows), risky: n(risky?.n) },
    findingsByType: Object.fromEntries(byType.map((t) => [t.type, n(t.n)])),
    decisions: {
      accepted: count('accepted', false),
      edited: count('accepted', true),
      rejected: count('rejected', false),
      pending: count('pending', false),
      bulkAcceptedRows: n(events?.bulk),
      undone: n(events?.undone),
    },
    review: { medianSecondsPerRow: review.median, sampleIntervals: review.samples },
    demo: { sessions: n(demo?.total), last30Days: n(demo?.recent) },
    leads: { total: n(leads?.total), withFile: n(leads?.files), last30Days: n(leads?.recent) },
  };
}
