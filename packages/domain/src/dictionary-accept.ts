// Accepts findings whose suggestion came from the firm dictionary, as one
// undoable bulk event. Used for the "accept dictionary matches" button and for
// the org's auto-accept setting, which is recorded as the system, not a person.
// Same screening as every bulk decision: live codes only, one code per row.
import { randomUUID } from 'node:crypto';
import { readEvidence } from '@tasnivo/core/match/evidence';
import { AUTO_ACCEPT_MIN_CONFIRMATIONS } from '@tasnivo/core/match/dictionary';
import { db } from '@tasnivo/db';
import { screenTargets } from './decide-many.js';
import { AUTO_ACCEPTED_ACTION, type DecisionSource } from './decision-source.js';

type Who = { orgId: string; userId: string | null };

/** `button`: a person clicked accept. `auto`: the org setting after an audit; only confirmed entries qualify. */
export type DictionaryAcceptMode = 'button' | 'auto';

type Candidate = { evidence: unknown };

/** Auto-accept trusts only entries a person confirmed at least once; bulk-learned ones wait for review. */
export function eligibleForAuto(finding: Candidate): boolean {
  return (readEvidence(finding.evidence)?.dictionaryConfirmations ?? 0) >= AUTO_ACCEPT_MIN_CONFIRMATIONS;
}

type Found = { id: string; suggestedMxik: string | null; confidence: number | null; evidence: unknown; item: { id: string; rawName: string; unit: string | null; barcode: string | null } };

/** The findings that may be accepted now: archived codes and rows holding (or getting) another code drop out. */
async function screened(found: Found[]): Promise<Found[]> {
  const { ready } = await screenTargets('accepted', found.map((f) => ({
    id: f.id, itemId: f.item.id, code: f.suggestedMxik, rawName: f.item.rawName, unit: f.item.unit, barcode: f.item.barcode,
  })));
  const ok = new Set(ready.map((t) => t.id));
  return found.filter((f) => ok.has(f.id));
}

const none = { count: 0, eventId: null };

export async function acceptDictionaryMatches(
  who: Who,
  catalogId: string,
  mode: DictionaryAcceptMode = 'button',
): Promise<{ count: number; eventId: string | null }> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, orgId: who.orgId }, select: { id: true } });
  if (!catalog) return none;

  const found = await db.finding.findMany({
    where: {
      item: { catalogId: catalog.id }, decision: 'pending', suggestedMxik: { not: null },
      type: { in: ['MISSING', 'NOT_FOUND', 'MISMATCH'] },
      evidence: { path: ['stage'], equals: 'dictionary' },
    },
    select: { id: true, suggestedMxik: true, confidence: true, evidence: true, item: { select: { id: true, rawName: true, unit: true, barcode: true } } },
  });
  const auto = mode === 'auto';
  const targets = await screened(auto ? found.filter(eligibleForAuto) : found);
  if (targets.length === 0) return none;

  const source: DecisionSource = auto ? 'dictionary_auto' : 'dictionary';
  // An automatic acceptance is the system's, not the uploader's: no actor, no decider.
  const decider = auto ? null : who.userId;
  const eventId = randomUUID();
  const now = new Date();
  const ids = targets.map((f) => f.id);
  const done = await db.$transaction(async (tx) => {
    // Same queue as a person's decision; the sibling check repeats inside the statement.
    await tx.$queryRaw`SELECT id FROM catalog_item WHERE id = ANY(${[...new Set(targets.map((f) => f.item.id))]}) ORDER BY id FOR UPDATE`;
    const updated = await tx.$queryRaw<{ id: string }[]>`
      UPDATE finding f SET decision = 'accepted'::decision, "chosenMxik" = f."suggestedMxik",
        "decidedBy" = ${decider}, "decidedAt" = ${now}, "decisionEventId" = ${eventId}, "decisionSource" = ${source}
      WHERE f.id = ANY(${ids}) AND f.decision = 'pending'::decision
        AND NOT EXISTS (SELECT 1 FROM finding s WHERE s."itemId" = f."itemId" AND s.id <> f.id
          AND s.decision = 'accepted'::decision AND s."chosenMxik" IS NOT NULL AND s."chosenMxik" <> f."suggestedMxik")
      RETURNING f.id`;
    if (updated.length === 0) return 0;
    const touched = new Set(updated.map((r) => r.id));
    const rows = targets.filter((f) => touched.has(f.id));
    await tx.auditEvent.create({
      data: {
        id: eventId, orgId: who.orgId, actorId: decider, createdAt: now,
        action: auto ? AUTO_ACCEPTED_ACTION : 'finding.bulk_accepted', targetId: catalog.id,
        payload: {
          catalogId: catalog.id, source, count: rows.length,
          ...(auto ? { setting: 'dictAutoAccept', triggeredBy: who.userId } : {}),
          findings: rows.map((f) => ({
            id: f.id, productName: f.item.rawName, chosenMxik: f.suggestedMxik, confidence: f.confidence,
            dictionaryConfirmations: readEvidence(f.evidence)?.dictionaryConfirmations ?? null,
          })),
        },
      },
    });
    return rows.length;
  }, { timeout: 120_000 });
  return done === 0 ? none : { count: done, eventId };
}
