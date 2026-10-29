// Server-side record of every signed-in browser, so a session can be listed and ended.
import { db } from '@tasnivo/db';
import { demoIdleMinutes } from '../demo-config.js';

const TOUCH_EVERY_MS = 5 * 60_000;
/** The cookie's lifetime; a record not seen for this long is dead too. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const MAX_IDLE_MS = SESSION_MAX_AGE_SECONDS * 1000;
/**
 * Absolute limit, counted from the record's createdAt: however active, a session ends 30 days after
 * the sign-in that opened it (the idle limit alone let a busy, possibly stolen cookie live forever).
 */
export const SESSION_ABSOLUTE_MAX_MS = 30 * 24 * 60 * 60_000;

/** How long a record may sit unused, how often "last seen" is refreshed, and how old it may get. */
type Limits = { maxIdleMs: number; touchMs: number; maxAgeMs: number };

const DEFAULT_LIMITS: Limits = { maxIdleMs: MAX_IDLE_MS, touchMs: TOUCH_EVERY_MS, maxAgeMs: SESSION_ABSOLUTE_MAX_MS };

/** A demo ends after a short idle period (DEMO_IDLE_MINUTES), so its clock is refreshed every minute. */
const demoLimits = (): Limits => ({ maxIdleMs: demoIdleMinutes() * 60_000, touchMs: 60_000, maxAgeMs: SESSION_ABSOLUTE_MAX_MS });

export type SessionRow = { id: string; userAgent: string | null; createdAt: Date; lastSeenAt: Date };

export async function createRecord(userId: string, orgId: string, userAgent: string | null): Promise<string> {
  const row = await db.userSession.create({ data: { userId, orgId, userAgent: userAgent?.slice(0, 200) ?? null }, select: { id: true } });
  return row.id;
}

/**
 * True while the record exists, belongs to the user, is not revoked, was seen within the cookie
 * lifetime and is younger than the absolute limit. Refreshes "last seen" now and then.
 */
export async function isLive(sid: string, userId: string, now = Date.now(), limits: Limits = DEFAULT_LIMITS): Promise<boolean> {
  const row = await db.userSession.findUnique({ where: { id: sid }, select: { userId: true, revokedAt: true, lastSeenAt: true, createdAt: true } });
  if (!row || row.userId !== userId || row.revokedAt) return false;
  if (now - row.createdAt.getTime() > limits.maxAgeMs) return false;
  const idle = now - row.lastSeenAt.getTime();
  if (idle > limits.maxIdleMs) return false;
  if (idle > limits.touchMs) await db.userSession.update({ where: { id: sid }, data: { lastSeenAt: new Date(now) } });
  return true;
}

/**
 * A cookie is good when its record is live. A demo needs one too, and its idle limit is the short demo one:
 * nothing a browser sends can keep a demo open past DEMO_IDLE_MINUTES without activity.
 */
export async function recordAccepted(sid: string | undefined, userId: string, demoOrg: boolean, now = Date.now()): Promise<boolean> {
  return sid ? isLive(sid, userId, now, demoOrg ? demoLimits() : DEFAULT_LIMITS) : false;
}

export async function listSessions(userId: string, now = Date.now()): Promise<SessionRow[]> {
  return db.userSession.findMany({
    where: { userId, revokedAt: null, lastSeenAt: { gt: new Date(now - MAX_IDLE_MS) }, createdAt: { gt: new Date(now - SESSION_ABSOLUTE_MAX_MS) } },
    orderBy: { lastSeenAt: 'desc' }, take: 50, select: { id: true, userAgent: true, createdAt: true, lastSeenAt: true },
  });
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

/** Ends one record without an audit entry (sign-out, a demo replacing the session). */
export async function endRecord(sid: string): Promise<void> {
  await db.userSession.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Ends every session of a user except `keepSid`; the caller writes the audit entry that explains why. */
export async function endUserSessions(userId: string, keepSid: string | null = null): Promise<number> {
  const done = await db.userSession.updateMany({ where: { userId, revokedAt: null, ...(keepSid ? { id: { not: keepSid } } : {}) }, data: { revokedAt: new Date() } });
  return done.count;
}

/** Ends every session of an org (account closed). */
export async function revokeOrgSessions(orgId: string): Promise<void> {
  await db.userSession.updateMany({ where: { orgId, revokedAt: null }, data: { revokedAt: new Date() } });
}
