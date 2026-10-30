// In-app notices when a removed member's open reviews change hands (F18): the new assignee is told
// as on any assignment (same kind, wording and dedupe key), and whoever handed out a dropped review
// is told it is gone. Personal and in-app only. Sent after the removal commits; a failed notice is
// logged and never undoes or fails the removal.
import { db } from '@tasnivo/db';
import { inEveryLocale, reviewAssignedText, reviewDroppedText, type NoticeTexts } from './notification-text.js';
import { notify } from './notifications.js';
import { orgLocale } from './org-locale.js';

/** An open review as it was when its assignee was removed; `revision` is the one after a hand-over. */
export type MovedReview = {
  id: string;
  clientId: string;
  catalogId: string;
  createdBy: string | null;
  dueOn: Date | null;
  note: string | null;
  revision: number;
  filename: string;
  clientName: string;
};

type Removal = { orgId: string; actorId: string; removedId: string; removedEmail: string };

async function send(orgId: string, userId: string, kind: string, review: MovedReview, text: NoticeTexts, dedupeKey: string): Promise<void> {
  try {
    const locale = await orgLocale(orgId);
    await notify({ orgId, clientId: review.clientId, userId, kind, ...text[locale], text, href: `/catalogs/${review.catalogId}`, dedupeKey, external: false });
  } catch (error) {
    console.warn(`[review-handover ${review.id}] notice failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** One `review.assigned` notice per handed-over review to the new assignee, unless they did the hand-over themselves. */
export async function noticeHandedOver(removal: Removal, takerId: string, reviews: readonly MovedReview[]): Promise<void> {
  if (takerId === removal.actorId || reviews.length === 0) return;
  const by = (await db.user.findUnique({ where: { id: removal.actorId }, select: { email: true } }))?.email;
  for (const r of reviews) {
    const text = inEveryLocale((l) => reviewAssignedText({ clientName: r.clientName, filename: r.filename, dueOn: r.dueOn, note: r.note, by }, l));
    await send(removal.orgId, takerId, 'review.assigned', r, text, `review.assigned:${r.id}:${r.revision}`);
  }
}

/**
 * One `review.dropped` notice per dropped review to whoever handed it out, when that person is
 * still a member of the org and is neither the removed member nor the admin who dropped it.
 */
export async function noticeDropped(removal: Removal, reviews: readonly MovedReview[]): Promise<void> {
  const givers = [...new Set(reviews.flatMap((r) => (r.createdBy && r.createdBy !== removal.actorId && r.createdBy !== removal.removedId ? [r.createdBy] : [])))];
  if (givers.length === 0) return;
  const members = new Set((await db.user.findMany({ where: { orgId: removal.orgId, id: { in: givers } }, select: { id: true } })).map((u) => u.id));
  const by = (await db.user.findUnique({ where: { id: removal.actorId }, select: { email: true } }))?.email;
  for (const r of reviews) {
    if (!r.createdBy || !members.has(r.createdBy)) continue;
    const text = inEveryLocale((l) => reviewDroppedText({ clientName: r.clientName, filename: r.filename, assignee: removal.removedEmail, by }, l));
    await send(removal.orgId, r.createdBy, 'review.dropped', r, text, `review.dropped:${r.id}:${r.revision}`);
  }
}
