// Accepts findings whose suggestion came from the firm dictionary, as one
// undoable bulk event. Used for the "accept dictionary matches" button and for
// the org's auto-accept setting, which is recorded as the system, not a person.
import { readEvidence } from '../core/match/evidence.js';
import { AUTO_ACCEPT_MIN_CONFIRMATIONS } from '../core/match/dictionary.js';
import { db } from './db.js';
import { AUTO_ACCEPTED_ACTION, type DecisionSource } from './decision-source.js';

type Who = { orgId: string; userId: string | null };

/** `button`: a person clicked accept. `auto`: the org setting after an audit; only confirmed entries qualify. */
export type DictionaryAcceptMode = 'button' | 'auto';

type Candidate = { evidence: unknown };

/** Auto-accept trusts only entries a person confirmed at least once; bulk-learned ones wait for review. */
export function eligibleForAuto(finding: Candidate): boolean {
  return (readEvidence(finding.evidence)?.dictionaryConfirmations ?? 0) >= AUTO_ACCEPT_MIN_CONFIRMATIONS;
}

export async function acceptDictionaryMatches(
  who: Who,
  catalogId: string,
  mode: DictionaryAcceptMode = 'button',
): Promise<{ count: number; eventId: string | null }> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, orgId: who.orgId }, select: { id: true } });
  if (!catalog) return { count: 0, eventId: null };

  const found = await db.finding.findMany({
    where: {
      item: { catalogId: catalog.id }, decision: 'pending', suggestedMxik: { not: null },
      type: { in: ['MISSING', 'NOT_FOUND', 'MISMATCH'] },
      evidence: { path: ['stage'], equals: 'dictionary' },
    },
    select: { id: true, suggestedMxik: true, confidence: true, evidence: true, item: { select: { rawName: true } } },
  });
  const auto = mode === 'auto';
  const eligible = auto ? found.filter(eligibleForAuto) : found;
  if (eligible.length === 0) return { count: 0, eventId: null };

  // Only codes that are live in the classifier right now may be accepted.
  const codes = [...new Set(eligible.map((f) => f.suggestedMxik).filter((c): c is string => c !== null))];
  const live = new Set((await db.$queryRaw<{ code: string }[]>`
    SELECT code FROM mxik_code WHERE code = ANY(${codes}) AND "retiredAt" IS NULL`).map((r) => r.code.trim()));
  const targets = eligible.filter((f) => f.suggestedMxik && live.has(f.suggestedMxik));
  if (targets.length === 0) return { count: 0, eventId: null };

  const source: DecisionSource = auto ? 'dictionary_auto' : 'dictionary';
  // An automatic acceptance is the system's, not the uploader's: no actor, no decider.
  const decider = auto ? null : who.userId;
  const eventId = await db.$transaction(async (tx) => {
    const event = await tx.auditEvent.create({
      data: {
        orgId: who.orgId, actorId: decider, action: auto ? AUTO_ACCEPTED_ACTION : 'finding.bulk_accepted', targetId: catalog.id,
        payload: {
          catalogId: catalog.id, source, count: targets.length,
          ...(auto ? { setting: 'dictAutoAccept', triggeredBy: who.userId } : {}),
          findings: targets.map((f) => ({
            id: f.id, productName: f.item.rawName, chosenMxik: f.suggestedMxik, confidence: f.confidence,
            dictionaryConfirmations: readEvidence(f.evidence)?.dictionaryConfirmations ?? null,
          })),
        },
      },
    });
    const ids = targets.map((f) => f.id);
    await tx.$executeRaw`
      UPDATE finding SET decision = 'accepted'::decision, "chosenMxik" = "suggestedMxik",
        "decidedBy" = ${decider}, "decidedAt" = ${event.createdAt}, "decisionEventId" = ${event.id}, "decisionSource" = ${source}
      WHERE id = ANY(${ids}) AND decision = 'pending'::decision`;
    return event.id;
  }, { timeout: 120_000 });
  return { count: targets.length, eventId };
}
