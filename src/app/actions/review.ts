'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { searchClassifier } from '@/lib/audit-runner';
import { BANDS } from '@/core/match/score';

const DecideInput = z.object({
  findingId: z.string().min(1),
  decision: z.enum(['accepted', 'rejected']),
  /** Present when the reviewer picked a code other than the suggestion. */
  chosenMxik: z.string().regex(/^\d{17}$/).nullable().optional(),
});

export type DecideResult = { ok: true } | { ok: false; error: string };

/** Records one accept/reject, and appends to the audit log. Never updates it. */
export async function decide(payload: unknown): Promise<DecideResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: t.errorGeneric };

  const parsed = DecideInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: t.errorGeneric };
  const { findingId, decision, chosenMxik } = parsed.data;

  // Scope through the relation: a finding id alone must not reach another org.
  const finding = await db.finding.findFirst({
    where: { id: findingId, item: { catalog: { orgId: user.orgId } } },
    select: { id: true, suggestedMxik: true, type: true, item: { select: { rawName: true } } },
  });
  if (!finding) return { ok: false, error: t.errorGeneric };

  const chosen = decision === 'accepted'
    ? (chosenMxik ?? finding.suggestedMxik)
    : null;

  await db.finding.update({
    where: { id: findingId },
    data: {
      decision,
      chosenMxik: chosen,
      decidedBy: user.userId,
      decidedAt: new Date(),
    },
  });

  // This record is the long-term asset: a growing product-name-to-verified-code
  // dataset, and what a client shows an inspector as evidence of due diligence.
  await db.auditEvent.create({
    data: {
      orgId: user.orgId,
      actorId: user.userId,
      action: `finding.${decision}`,
      targetId: findingId,
      payload: {
        type: finding.type,
        productName: finding.item.rawName,
        suggestedMxik: finding.suggestedMxik,
        chosenMxik: chosen,
        overrodeSuggestion: chosen !== null && chosen !== finding.suggestedMxik,
      },
    },
  });

  revalidatePath('/review');
  revalidatePath('/export');
  return { ok: true };
}

const BulkInput = z.object({
  catalogId: z.string().min(1),
  // Enforced here, not trusted from the browser: bulk accept is only ever for
  // the high band, which retrieval alone cannot reach.
  minConfidence: z.number().min(BANDS.high).max(1),
});

export type BulkResult = { ok: true; count: number } | { ok: false; error: string };

/** "Accept all above 90%." Only touches pending findings that have a suggestion. */
export async function acceptAllAbove(payload: unknown): Promise<BulkResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: t.errorGeneric };

  const parsed = BulkInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: t.errorGeneric };
  const { catalogId, minConfidence } = parsed.data;

  const targets = await db.finding.findMany({
    where: {
      item: { catalogId, catalog: { orgId: user.orgId } },
      decision: 'pending',
      confidence: { gte: minConfidence },
      suggestedMxik: { not: null },
    },
    select: { id: true, suggestedMxik: true, type: true, confidence: true, item: { select: { rawName: true } } },
  });
  if (targets.length === 0) return { ok: true, count: 0 };

  const now = new Date();
  await db.$transaction([
    db.finding.updateMany({
      where: { id: { in: targets.map((f) => f.id) } },
      data: { decision: 'accepted', decidedBy: user.userId, decidedAt: now },
    }),
    // chosenMxik is per-row, so it cannot be set by updateMany.
    ...targets.map((f) =>
      db.finding.update({ where: { id: f.id }, data: { chosenMxik: f.suggestedMxik } })),
    db.auditEvent.create({
      data: {
        orgId: user.orgId,
        actorId: user.userId,
        action: 'finding.bulk_accepted',
        targetId: catalogId,
        payload: {
          minConfidence,
          count: targets.length,
          findings: targets.map((f) => ({
            id: f.id,
            productName: f.item.rawName,
            chosenMxik: f.suggestedMxik,
            confidence: f.confidence,
          })),
        },
      },
    }),
  ]);

  revalidatePath('/review');
  revalidatePath('/export');
  return { ok: true, count: targets.length };
}

export type ClassifierHit = {
  code: string;
  name: string;
  path: string;
  isBase: boolean;
  unit: string | null;
};

/** Backs the "pick another code" search box on the Review screen. */
export async function lookupCodes(query: string): Promise<ClassifierHit[]> {
  const user = await currentUser();
  if (!user) return [];
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const hits = await searchClassifier(trimmed, 10);
  return hits.map((c) => ({
    code: c.code,
    name: c.nameUz,
    path: [c.groupName, c.className, c.positionName, c.subPositionName]
      .filter((s): s is string => Boolean(s)).join(' → '),
    isBase: c.isBase,
    unit: c.unitBinding === 'strict' && c.unitCanonical.length > 0
      ? c.unitCanonical.join(' / ')
      : null,
  }));
}
