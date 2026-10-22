// Changing and removing team members. The last admin can never be demoted, client access is an
// explicit choice (all clients, or a non-empty selection), and a removed member is cut off at
// once: sessions end, the API keys they created are revoked, the Telegram chats they linked are
// unlinked, their pending invites die. A member who stops being an admin loses the same org-wide
// reach (API keys and linked chats are admin-only features).
// Every function re-checks that the actor is an admin; the server action guard is the first layer.
import type { Prisma } from '@prisma/client';
import { db } from './db';
import type { Role } from './session';

type Actor = { userId: string; orgId: string; role: Role };
type Tx = Prisma.TransactionClient;

export type ClientAccess = 'all' | 'selected';
export type MemberChange = { userId: string; role: Role; access: ClientAccess; clientIds: readonly string[] };
export type ChangeResult = { ok: true; clients: number } | { ok: false; reason: 'forbidden' | 'not_found' | 'last_admin' | 'no_clients' };

/** Admin rows of the org, locked until the transaction ends, so two admins cannot demote each other at once. */
async function lockedAdminCount(tx: Tx, orgId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "user" WHERE "orgId" = ${orgId} AND role = 'admin' FOR UPDATE`;
  return rows.length;
}

/** The org's own clients among `ids`; anything else is dropped. */
export async function ownedClientIds(orgId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.client.findMany({ where: { orgId, archivedAt: null, id: { in: [...new Set(ids)] } }, select: { id: true } });
  return rows.map((r) => r.id);
}

type CutReason = 'member_removed' | 'member_demoted';

/** Revokes the member's live API keys: a key outliving its creator's admin role would keep their access. */
async function revokeKeysOf(tx: Tx, actor: Actor, userId: string, now: Date, reason: CutReason): Promise<string[]> {
  const keys = await tx.apiKey.findMany({ where: { orgId: actor.orgId, createdBy: userId, revokedAt: null }, select: { id: true, name: true } });
  if (keys.length === 0) return [];
  const ids = keys.map((k) => k.id);
  await tx.apiKey.updateMany({ where: { id: { in: ids }, revokedAt: null }, data: { revokedAt: now } });
  await tx.auditEvent.createMany({
    data: keys.map((k) => ({
      orgId: actor.orgId, actorId: actor.userId, action: 'apikey.revoked', targetId: k.id,
      payload: { name: k.name, reason, memberId: userId },
    })),
  });
  return ids;
}

/** Revokes the member's API keys, unlinks the Telegram chats they linked and drops their unused link codes. */
async function cutOrgWideAccess(tx: Tx, actor: Actor, userId: string, reason: CutReason, now: Date): Promise<{ keyIds: string[]; chats: number }> {
  const keyIds = await revokeKeysOf(tx, actor, userId, now, reason);
  const chats = await tx.telegramLink.deleteMany({ where: { orgId: actor.orgId, linkedBy: userId } });
  await tx.telegramLinkCode.deleteMany({ where: { orgId: actor.orgId, userId, usedAt: null } });
  return { keyIds, chats: chats.count };
}

export async function changeMember(actor: Actor, input: MemberChange): Promise<ChangeResult> {
  if (actor.role !== 'admin') return { ok: false, reason: 'forbidden' };
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
    // A non-admin may hold no org-wide key or chat, whatever their client access.
    const cut = input.role === 'admin' ? null : await cutOrgWideAccess(tx, actor, target.id, 'member_demoted', new Date());
    const cutCounts = cut && (cut.keyIds.length > 0 || cut.chats > 0)
      ? { apiKeysRevoked: cut.keyIds.length, telegramUnlinked: cut.chats, apiKeyIds: cut.keyIds }
      : {};
    await tx.auditEvent.create({
      data: {
        orgId: actor.orgId, actorId: actor.userId, action: 'team.updated', targetId: target.id,
        payload: { role: input.role, previousRole: target.role, access: scoped ? 'selected' : 'all', clients: owned.length, ...cutCounts },
      },
    });
    return { ok: true, clients: owned.length };
  });
}

export type RemoveResult =
  | { ok: true; email: string; sessionsEnded: number; apiKeysRevoked: number; telegramUnlinked: number; invitesRevoked: number }
  | { ok: false; reason: 'forbidden' | 'self' | 'not_found' | 'last_admin' };

export async function removeTeamMember(actor: Actor, userId: string): Promise<RemoveResult> {
  if (actor.role !== 'admin') return { ok: false, reason: 'forbidden' };
  if (userId === actor.userId) return { ok: false, reason: 'self' };
  const target = await db.user.findFirst({ where: { id: userId, orgId: actor.orgId }, select: { id: true, email: true, role: true } });
  if (!target) return { ok: false, reason: 'not_found' };

  // One transaction: the last-admin check runs under lock before anything is cut off, so a
  // refused removal signs nobody out, and a failure halfway leaves the member as they were.
  return db.$transaction(async (tx): Promise<RemoveResult> => {
    if (target.role === 'admin' && (await lockedAdminCount(tx, actor.orgId)) <= 1) return { ok: false, reason: 'last_admin' };
    const now = new Date();
    const sessions = await tx.userSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now } });
    const { keyIds, chats } = await cutOrgWideAccess(tx, actor, target.id, 'member_removed', now);
    const invites = await tx.invite.deleteMany({ where: { orgId: actor.orgId, createdBy: target.id, usedAt: null } });
    await tx.user.delete({ where: { id: target.id } });
    const counts = { sessionsEnded: sessions.count, apiKeysRevoked: keyIds.length, telegramUnlinked: chats, invitesRevoked: invites.count };
    await tx.auditEvent.create({
      data: {
        orgId: actor.orgId, actorId: actor.userId, action: 'team.removed', targetId: target.id,
        payload: { email: target.email, role: target.role, ...counts, apiKeyIds: keyIds },
      },
    });
    return { ok: true, email: target.email, ...counts };
  });
}

export type RevokeResult = { ok: true } | { ok: false; reason: 'forbidden' | 'not_found' };

/** Deletes a pending invite of the org; the link stops working at once. */
export async function revokeTeamInvite(actor: Actor, inviteId: string): Promise<RevokeResult> {
  if (actor.role !== 'admin') return { ok: false, reason: 'forbidden' };
  const invite = await db.invite.findFirst({ where: { id: inviteId, orgId: actor.orgId, usedAt: null }, select: { id: true, email: true, role: true } });
  if (!invite) return { ok: false, reason: 'not_found' };
  const done = await db.invite.deleteMany({ where: { id: invite.id, usedAt: null } });
  if (done.count === 0) return { ok: false, reason: 'not_found' };
  await db.auditEvent.create({ data: { orgId: actor.orgId, actorId: actor.userId, action: 'team.invite_revoked', targetId: invite.id, payload: { email: invite.email, role: invite.role } } });
  return { ok: true };
}
