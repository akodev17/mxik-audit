'use server';

import { z } from 'zod';
import { readEvidence } from '@/core/match/evidence';
import { confidenceLabel } from '@/core/match/confidence-labels';
import { catalogScope } from '@/lib/access';
import { db } from '@/lib/db';
import { writer } from '@/lib/guard';
import { WRONG_REASONS } from '@/lib/wrong-reasons';

const Input = z.object({
  findingId: z.string().min(1),
  reason: z.enum(WRONG_REASONS),
  note: z.string().max(500).optional(),
});

/** "Taklif notoʻgʻri": records why, with the stage and label that produced the suggestion. */
export async function reportWrongSuggestion(payload: unknown): Promise<{ ok: boolean }> {
  const user = await writer();
  const parsed = Input.safeParse(payload);
  if (!user || !parsed.success) return { ok: false };
  const finding = await db.finding.findFirst({
    where: { id: parsed.data.findingId, item: { catalog: catalogScope(user) } },
    select: { id: true, suggestedMxik: true, confidence: true, evidence: true, item: { select: { rawName: true, catalogId: true } } },
  });
  if (!finding?.suggestedMxik) return { ok: false };

  const evidence = readEvidence(finding.evidence);
  const stage = evidence?.stage ?? null;
  const label = finding.confidence === null ? null : confidenceLabel(finding.confidence, { barcode: stage === 'barcode' || stage === 'dictionary' });
  const note = parsed.data.note?.trim() || null;
  const data = { orgId: user.orgId, userId: user.userId, reason: parsed.data.reason, note, stage, label, suggestedMxik: finding.suggestedMxik, productName: finding.item.rawName };
  await db.suggestionFeedback.upsert({ where: { findingId: finding.id }, create: { findingId: finding.id, ...data }, update: data });
  await db.auditEvent.create({
    data: {
      orgId: user.orgId, actorId: user.userId, action: 'suggestion.reported_wrong', targetId: finding.id,
      payload: { catalogId: finding.item.catalogId, reason: parsed.data.reason, suggestedMxik: finding.suggestedMxik, stage },
    },
  });
  return { ok: true };
}
