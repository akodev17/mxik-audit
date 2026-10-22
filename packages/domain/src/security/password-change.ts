// A signed-in user changes their password: the current one is required, other sessions end.
import { db } from '../db.js';
import { hashPassword, verifyPassword } from '../password.js';
import { passwordAcceptable } from './password-check.js';
import { endUserSessions } from './session-store.js';

export type ChangeResult = { ok: true; sessionsEnded: number } | { ok: false; error: 'wrong' | 'short' };

export async function changePassword(actor: { userId: string; orgId: string }, current: string, next: string, keepSid: string | null): Promise<ChangeResult> {
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { passwordHash: true } });
  if (!user || !(await verifyPassword(current, user.passwordHash))) return { ok: false, error: 'wrong' };
  if (!passwordAcceptable(next)) return { ok: false, error: 'short' };
  await db.user.update({ where: { id: actor.userId }, data: { passwordHash: await hashPassword(next) } });
  const sessionsEnded = await endUserSessions(actor.userId, keepSid);
  await db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'security.password_changed', targetId: actor.userId, payload: { sessionsEnded } } });
  return { ok: true, sessionsEnded };
}
