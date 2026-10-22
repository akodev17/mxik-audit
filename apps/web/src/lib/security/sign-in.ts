// The one place a browser becomes signed in: password, Telegram, e-mail link, new account or invite.
// A user with two-factor on is held in a pending state until the code is entered.
import { headers } from 'next/headers';
import { db } from '@tasnivo/db';
import { getSession, type SessionData } from '../session';
import { createRecord, endRecord } from '@tasnivo/domain/security/session-store';
import { checkPendingCode } from '@tasnivo/domain/security/two-factor-attempts';

const PENDING_MS = 10 * 60_000;

type Who = { id: string; orgId: string; email: string };
type Options = { via: string; landing: string };

export const TWO_FACTOR_PATH = '/sign-in/2fa';
export const DELETED_PATH = '/account-deleted';

/** Drops the pending two-factor state and a pending Telegram binding. */
export function clearPending(session: SessionData): void {
  session.pendingUserId = undefined;
  session.pendingVia = undefined;
  session.pendingLanding = undefined;
  session.pendingAt = undefined;
  session.tgBind = undefined;
  session.tgBindAt = undefined;
}

async function finish(who: Who, via: string): Promise<void> {
  const session = await getSession();
  const agent = (await headers()).get('user-agent');
  // A browser that was signed in as someone else (or a demo) loses that record first.
  if (session.sid) await endRecord(session.sid);
  session.sid = await createRecord(who.id, who.orgId, agent);
  session.userId = who.id;
  session.orgId = who.orgId;
  session.email = who.email;
  // Nothing from an earlier session (a demo, another org's client) carries over.
  session.demo = false;
  session.clientId = undefined;
  clearPending(session);
  await session.save();
  await db.auditEvent.create({ data: { orgId: who.orgId, actorId: who.id, action: 'user.signed_in', payload: { via } } });
}

/** Where to send the browser next, or null when this user may not sign in (closed account, not an admin). */
export async function openSession(who: Who, { via, landing }: Options): Promise<string | null> {
  const [user, org] = await Promise.all([
    db.user.findUnique({ where: { id: who.id }, select: { role: true, totpEnabledAt: true } }),
    db.organization.findUnique({ where: { id: who.orgId }, select: { deletedAt: true } }),
  ]);
  if (!user || !org) return null;
  if (org.deletedAt && user.role !== 'admin') return null;
  if (user.totpEnabledAt) {
    const session = await getSession();
    session.pendingUserId = who.id;
    session.pendingVia = via;
    session.pendingLanding = landing;
    session.pendingAt = Date.now();
    await session.save();
    return TWO_FACTOR_PATH;
  }
  await finish(who, via);
  return org.deletedAt ? DELETED_PATH : landing;
}

export type PendingResult = { ok: true; next: string } | { ok: false; reason: 'wrong' | 'locked' | 'expired' };

/** Finishes a pending sign-in with an authenticator or recovery code. After too many wrong codes the password is asked again. */
export async function completePending(input: string): Promise<PendingResult> {
  const session = await getSession();
  const { pendingUserId, pendingAt, pendingVia, pendingLanding } = session;
  if (!pendingUserId || !pendingAt || Date.now() - pendingAt > PENDING_MS) return { ok: false, reason: 'expired' };
  const check = await checkPendingCode(pendingUserId, pendingAt, input);
  if (check === 'locked') {
    clearPending(session);
    await session.save();
    return { ok: false, reason: 'locked' };
  }
  if (check === 'wrong') return { ok: false, reason: 'wrong' };
  const user = await db.user.findUnique({ where: { id: pendingUserId }, select: { id: true, orgId: true, email: true, org: { select: { deletedAt: true } } } });
  if (!user) return { ok: false, reason: 'expired' };
  await finish(user, pendingVia ?? 'password');
  return { ok: true, next: user.org.deletedAt ? DELETED_PATH : pendingLanding ?? '/dashboard' };
}

export async function hasPending(): Promise<boolean> {
  const { pendingUserId, pendingAt } = await getSession();
  return Boolean(pendingUserId && pendingAt && Date.now() - pendingAt <= PENDING_MS);
}
