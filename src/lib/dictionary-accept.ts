// Accepts findings whose suggestion came from the firm dictionary, as one
// undoable bulk event. Used for the org's auto-accept setting and the button.
import { db } from './db.js';

type Who = { orgId: string; userId: string | null };

export async function acceptDictionaryMatches(who: Who, catalogId: string): Promise<{ count: number; eventId: string | null }> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, orgId: who.orgId }, select: { id: true } });
  if (!catalog) return { count: 0, eventId: null };

  const found = await db.finding.findMany({
    where: {
      item: { catalogId: catalog.id }, decision: 'pending', suggestedMxik: { not: null },
      type: { in: ['MISSING', 'NOT_FOUND', 'MISMATCH'] },
      evidence: { path: ['stage'], equals: 'dictionary' },
    },
    select: { id: true, suggestedMxik: true, confidence: true, item: { select: { rawName: true } } },
  });
  if (found.length === 0) return { count: 0, eventId: null };

  // Only codes that are live in the classifier right now may be accepted.
  const codes = [...new Set(found.map((f) => f.suggestedMxik).filter((c): c is string => c !== null))];
  const live = new Set((await db.$queryRaw<{ code: string }[]>`
    SELECT code FROM mxik_code WHERE code = ANY(${codes}) AND "retiredAt" IS NULL`).map((r) => r.code.trim()));
  const targets = found.filter((f) => f.suggestedMxik && live.has(f.suggestedMxik));
  if (targets.length === 0) return { count: 0, eventId: null };

  const eventId = await db.$transaction(async (tx) => {
    const event = await tx.auditEvent.create({
      data: {
        orgId: who.orgId, actorId: who.userId, action: 'finding.bulk_accepted', targetId: catalog.id,
        payload: {
          catalogId: catalog.id, source: 'dictionary', count: targets.length,
          findings: targets.map((f) => ({ id: f.id, productName: f.item.rawName, chosenMxik: f.suggestedMxik, confidence: f.confidence })),
        },
      },
    });
    const ids = targets.map((f) => f.id);
    await tx.$executeRaw`
      UPDATE finding SET decision = 'accepted'::decision, "chosenMxik" = "suggestedMxik",
        "decidedBy" = ${who.userId}, "decidedAt" = ${event.createdAt}, "decisionEventId" = ${event.id}
      WHERE id = ANY(${ids}) AND decision = 'pending'::decision`;
    return event.id;
  }, { timeout: 120_000 });
  return { count: targets.length, eventId };
}
