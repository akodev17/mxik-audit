// Uncommitted upload previews (status "uploaded") do not use the monthly row
// allowance, so they must not pile up: a user's next upload replaces their
// earlier open preview, and the daily job deletes any preview older than
// 48 hours. Every deletion is logged as catalog.upload_discarded. Server-only.
import { db } from '@tasnivo/db';

export const PREVIEW_TTL_HOURS = 48;
const HOUR = 3_600_000;
/** Previews deleted per daily run at most; the rest go the next day. */
const SWEEP_BATCH = 500;

type Open = { id: string; orgId: string; clientId: string | null; filename: string; rowCount: number; createdAt: Date };
const OPEN = { id: true, orgId: true, clientId: true, filename: true, rowCount: true, createdAt: true } as const;

/** Deletes each preview that is still uncommitted and logs it; a commit that claimed it first wins. */
async function discard(previews: readonly Open[], actorId: string | null, reason: 'replaced' | 'expired'): Promise<number> {
  let removed = 0;
  for (const p of previews) {
    const done = await db.catalog.deleteMany({ where: { id: p.id, status: 'uploaded' } });
    if (done.count === 0) continue;
    removed++;
    await db.auditEvent.create({
      data: {
        orgId: p.orgId, actorId, action: 'catalog.upload_discarded', targetId: p.id,
        payload: { catalogId: p.id, clientId: p.clientId, filename: p.filename, rowCount: p.rowCount, reason },
      },
    });
  }
  return removed;
}

/**
 * Deletes the user's earlier open previews in the org before they upload a new
 * file. Catalogues carry no uploader, so "theirs" is read from the
 * catalog.uploaded event written in the same transaction as the catalogue.
 */
export async function discardEarlierPreviews(actor: { orgId: string; userId: string }): Promise<number> {
  const open = await db.catalog.findMany({ where: { orgId: actor.orgId, status: 'uploaded' }, select: OPEN });
  if (open.length === 0) return 0;
  const earliest = Math.min(...open.map((c) => c.createdAt.getTime()));
  const uploads = await db.auditEvent.findMany({
    where: {
      orgId: actor.orgId, action: 'catalog.uploaded', actorId: actor.userId,
      targetId: { in: open.map((c) => c.id) }, createdAt: { gte: new Date(earliest - HOUR) },
    },
    select: { targetId: true },
  });
  const mine = new Set(uploads.map((e) => e.targetId));
  return discard(open.filter((c) => mine.has(c.id)), actor.userId, 'replaced');
}

/** Daily: deletes previews never committed within PREVIEW_TTL_HOURS. */
export async function sweepExpiredPreviews(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PREVIEW_TTL_HOURS * HOUR);
  const expired = await db.catalog.findMany({
    where: { status: 'uploaded', createdAt: { lt: cutoff } },
    orderBy: { createdAt: 'asc' }, take: SWEEP_BATCH, select: OPEN,
  });
  return discard(expired, null, 'expired');
}
