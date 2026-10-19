// Changing and removing team members. The last admin can never be demoted, client access is an
// explicit choice (all clients, or a non-empty selection), and a removed member is cut off at
// once: sessions end, the Telegram chats they linked are unlinked, their pending invites die.
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { endUserSessions } from './security/session-store';
import type { Role } from './session';

type Actor = { userId: string; orgId: string };
type Tx = Prisma.TransactionClient;

export type ClientAccess = 'all' | 'selected';
export type MemberChange = { userId: string; role: Role; access: ClientAccess; clientIds: readonly string[] };
export type ChangeResult = { ok: true; clients: number } | { ok: false; reason: 'not_found' | 'last_admin' | 'no_clients' };

/** Admin rows of the org, locked until the transaction ends, so two admins cannot demote each other at once. */
async function lockedAdminCount(tx: Tx, orgId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "user" WHERE "orgId" = ${orgId} AND role = 'admin' FOR UPDATE`;
  return rows.length;
}

/** The org's own clients among `ids`; anything else is dropped. */
export async function ownedClientIds(orgId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.client.findMany({ where: { orgId, id: { in: [...new Set(ids)] } }, select: { id: true } });
  return rows.map((r) => r.id);
}

export async function changeMember(actor: Actor, input: MemberChange): Promise<ChangeResult> {
  const target = await db.user.findFirst({ where: { id: input.userId, orgId: actor.orgId }, select: { id: true, role: true } });
  if (!target) return { ok: false, reason: 'not_found' };
  // An admin sees every client; "all" is stored as no assignments.
  const scoped = input.role !== 'admin' && input.access === 'selected';
  const owned = scoped ? await ownedClientIds(actor.orgId, input.clientIds) : [];
  if (scoped && owned.length === 0) return { ok: false, reason: 'no_clients' };

  return db.$transaction(async (tx): Promise<ChangeResult> => {
    if (target.role === 'admin' && input.role !== 'admin' && (await lockedAdminCount(tx, actor.orgId)) <= 1) {
      return { ok: false, reason: 'last_admin' };
    }
    await tx.user.update({ where: { id: target.id }, data: { role: input.role } });
    await tx.clientAssignment.deleteMany({ where: { userId: target.id } });
    if (owned.length > 0) await tx.clientAssignment.createMany({ data: owned.map((clientId) => ({ userId: target.id, clientId })) });
    await tx.auditEvent.create({
      data: {
        orgId: actor.orgId, actorId: actor.userId, action: 'team.updated', targetId: target.id,
        payload: { role: input.role, previousRole: target.role, access: scoped ? 'selected' : 'all', clients: owned.length },
      },
    });
    return { ok: true, clients: owned.length };
  });
}

export type RemoveResult =
  | { ok: true; email: string; sessionsEnded: number; telegramUnlinked: number; invitesRevoked: number }
  | { ok: false; reason: 'self' | 'not_found' | 'last_admin' };

export async function removeTeamMember(actor: Actor, userId: string): Promise<RemoveResult> {
  if (userId === actor.userId) return { ok: false, reason: 'self' };
  const target = await db.user.findFirst({ where: { id: userId, orgId: actor.orgId }, select: { id: true, email: true, role: true } });
  if (!target) return { ok: false, reason: 'not_found' };
  if (target.role === 'admin' && (await db.user.count({ where: { orgId: actor.orgId, role: 'admin' } })) <= 1) return { ok: false, reason: 'last_admin' };

  // Sessions end first: if anything below fails, the member is at least signed out everywhere.
  const sessionsEnded = await endUserSessions(target.id);
  return db.$transaction(async (tx): Promise<RemoveResult> => {
    if (target.role === 'admin' && (await lockedAdminCount(tx, actor.orgId)) <= 1) return { ok: false, reason: 'last_admin' };
    const chats = await tx.telegramLink.deleteMany({ where: { orgId: actor.orgId, linkedBy: target.id } });
    await tx.telegramLinkCode.deleteMany({ where: { orgId: actor.orgId, userId: target.id, usedAt: null } });
    const invites = await tx.invite.deleteMany({ where: { orgId: actor.orgId, createdBy: target.id, usedAt: null } });
    await tx.user.delete({ where: { id: target.id } });
    await tx.auditEvent.create({
      data: {
        orgId: actor.orgId, actorId: actor.userId, action: 'team.removed', targetId: target.id,
        payload: { email: target.email, role: target.role, sessionsEnded, telegramUnlinked: chats.count, invitesRevoked: invites.count },
      },
    });
    return { ok: true, email: target.email, sessionsEnded, telegramUnlinked: chats.count, invitesRevoked: invites.count };
  });
}

export type RevokeResult = { ok: true } | { ok: false; reason: 'not_found' };

/** Deletes a pending invite of the org; the link stops working at once. */
export async function revokeTeamInvite(actor: Actor, inviteId: string): Promise<RevokeResult> {
  const invite = await db.invite.findFirst({ where: { id: inviteId, orgId: actor.orgId, usedAt: null }, select: { id: true, email: true, role: true } });
  if (!invite) return { ok: false, reason: 'not_found' };
  const done = await db.invite.deleteMany({ where: { id: invite.id, usedAt: null } });
  if (done.count === 0) return { ok: false, reason: 'not_found' };
  await db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'team.invite_revoked', targetId: invite.id, payload: { email: invite.email, role: invite.role } } });
  return { ok: true };
}
