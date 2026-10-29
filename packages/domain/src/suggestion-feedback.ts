// "Taklif notoʻgʻri": why a reviewer called a suggestion wrong, with the stage
// and label that produced it, for the accuracy metrics. Scoped and write-only
// for people who may change data. A wrong dictionary suggestion also disputes
// the entry it came from, so auto-accept stops trusting it.
import { readEvidence } from '@tasnivo/core/match/evidence';
import { confidenceLabel } from '@tasnivo/core/match/confidence-labels';
import { catalogScope } from './access';
import { db } from '@tasnivo/db';
import { dictionaryEntriesOf, disputeEntries } from './dictionary-dispute';
import type { WRONG_REASONS } from './wrong-reasons';
import { mayWrite, type RoleCarrier } from './write-access';

type Actor = { orgId: string; userId: string; clientIds?: string[] | null } & RoleCarrier;
type Input = { findingId: string; reason: (typeof WRONG_REASONS)[number]; note?: string };

export async function recordWrongSuggestion(actor: Actor, input: Input): Promise<boolean> {
  if (!mayWrite(actor)) return false;
  const finding = await db.finding.findFirst({
    where: { id: input.findingId, item: { catalog: catalogScope(actor) } },
    select: { id: true, suggestedMxik: true, confidence: true, evidence: true, item: { select: { rawName: true, unit: true, barcode: true, catalogId: true } } },
  });
  if (!finding?.suggestedMxik) return false;

  const stage = readEvidence(finding.evidence)?.stage ?? null;
  const label = finding.confidence === null ? null : confidenceLabel(finding.confidence, { barcode: stage === 'barcode' || stage === 'dictionary' });
  const note = input.note?.trim() || null;
  const data = { orgId: actor.orgId, userId: actor.userId, reason: input.reason, note, stage, label, suggestedMxik: finding.suggestedMxik, productName: finding.item.rawName };
  const entries = await dictionaryEntriesOf(actor.orgId, [finding]);
  await db.$transaction(async (tx) => {
    await tx.suggestionFeedback.upsert({ where: { findingId: finding.id }, create: { findingId: finding.id, ...data }, update: data });
    const disputed = await disputeEntries(tx, {
      orgId: actor.orgId, userId: actor.userId, at: new Date(), via: 'wrong_suggestion', catalogId: finding.item.catalogId, reason: input.reason, byFinding: entries,
    });
    await tx.auditEvent.create({
      data: {
        orgId: actor.orgId, actorId: actor.userId, action: 'suggestion.reported_wrong', targetId: finding.id,
        payload: { catalogId: finding.item.catalogId, reason: input.reason, suggestedMxik: finding.suggestedMxik, stage, ...(disputed.length > 0 ? { dictionaryDisputed: disputed } : {}) },
      },
    });
  });
  return true;
}
