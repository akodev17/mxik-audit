// Server-side record of every signed-in browser, so a session can be listed and ended.
import { db } from '../db';

const TOUCH_EVERY_MS = 5 * 60_000;

export type SessionRow = { id: string; userAgent: string | null; createdAt: Date; lastSeenAt: Date };

export async function createRecord(userId: string, orgId: string, userAgent: string | null): Promise<string> {
  const row = await db.userSession.create({ data: { userId, orgId, userAgent: userAgent?.slice(0, 200) ?? null }, select: { id: true } });
  return row.id;
}

/** True while the record exists, belongs to the user and is not revoked. Refreshes "last seen" now and then. */
export async function isLive(sid: string, userId: string): Promise<boolean> {
  const row = await db.userSession.findUnique({ where: { id: sid }, select: { userId: true, revokedAt: true, lastSeenAt: true } });
  if (!row || row.userId !== userId || row.revokedAt) return false;
  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) await db.userSession.update({ where: { id: sid }, data: { lastSeenAt: new Date() } });
  return true;
}

export async function listSessions(userId: string): Promise<SessionRow[]> {
  return db.userSession.findMany({ where: { userId, revokedAt: null }, orderBy: { lastSeenAt: 'desc' }, take: 50, select: { id: true, userAgent: true, createdAt: true, lastSeenAt: true } });
}

export async function revokeSession(actor: { userId: string; orgId: string }, sid: string): Promise<boolean> {
  const done = await db.userSession.updateMany({ where: { id: sid, userId: actor.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (done.count === 0) return false;
  await db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'security.session_revoked', targetId: sid, payload: {} } });
  return true;
}

export async function revokeOthers(actor: { userId: string; orgId: string }, keepSid: string | null): Promise<number> {
  const done = await db.userSession.updateMany({ where: { userId: actor.userId, revokedAt: null, ...(keepSid ? { id: { not: keepSid } } : {}) }, data: { revokedAt: new Date() } });
  if (done.count > 0) await db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'security.session_revoked', payload: { count: done.count } } });
  return done.count;
}

/** Ends every session of an org (account closed). */
export async function revokeOrgSessions(orgId: string): Promise<void> {
  await db.userSession.updateMany({ where: { orgId, revokedAt: null }, data: { revokedAt: new Date() } });
}
