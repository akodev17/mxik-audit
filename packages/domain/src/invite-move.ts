// Joining a firm with an account that already exists (plan D5, F8). A signed-in user accepts an
// invite and moves into the inviting org when the org they are in now holds nothing of value: no
// other users, no catalogues, no running paid subscription. That org is then closed the way an
// account closure closes it (security/account.ts: deletedAt set, erased by the daily purge after
// the grace period); no row is deleted here. Otherwise the answer says why and names the admin who
// sent the invite, so the person can ask them for another way in.
import type { Prisma } from '@prisma/client';
import { db } from '@tasnivo/db';
import { usableInvite } from './invites.js';
import { deleteAfterDays } from './security/account.js';
import type { Role } from './session.js';
import { lockOrgUsage } from './usage-ledger.js';

export type MoveRefusal = 'inviteBad' | 'inviteWrongEmail' | 'sameOrg' | 'orgKind' | 'members' | 'catalogs' | 'paid';
export type MoveCheck =
  | { ok: true; orgName: string; role: Role }
  | { ok: false; reason: MoveRefusal; adminEmail: string | null };
export type MoveResult = { ok: true; orgId: string } | { ok: false; reason: MoveRefusal; adminEmail: string | null };

type Actor = { userId: string; orgId: string; email: string };
type Reader = Pick<Prisma.TransactionClient, 'organization' | 'user' | 'catalog'>;
type Invite = NonNullable<Awaited<ReturnType<typeof usableInvite>>>;

/** Why the actor's current org cannot be closed for the move, or null when it is empty. */
async function blocker(tx: Reader, actor: Actor, now: Date): Promise<MoveRefusal | null> {
  const org = await tx.organization.findUnique({ where: { id: actor.orgId }, select: { kind: true, deletedAt: true, subscriptionUntil: true } });
  if (!org || org.kind !== 'customer' || org.deletedAt) return 'orgKind';
  const [others, catalogs] = await Promise.all([
    tx.user.count({ where: { orgId: actor.orgId, id: { not: actor.userId } } }),
    tx.catalog.count({ where: { orgId: actor.orgId } }),
  ]);
  if (others > 0) return 'members';
  if (catalogs > 0) return 'catalogs';
  // Paid time would be lost with the closed org; the owner decides such cases by hand.
  if (org.subscriptionUntil && org.subscriptionUntil > now) return 'paid';
  return null;
}

/** The admin who sent the invite while still in the org, else the org's first admin. */
async function invitingAdmin(invite: Invite): Promise<string | null> {
  const maker = invite.createdBy
    ? await db.user.findFirst({ where: { id: invite.createdBy, orgId: invite.orgId, role: 'admin' }, select: { email: true } })
    : null;
  if (maker) return maker.email;
  const first = await db.user.findFirst({ where: { orgId: invite.orgId, role: 'admin' }, orderBy: { createdAt: 'asc' }, select: { email: true } });
  return first?.email ?? null;
}

/** The checks that need no lock: the invite fits this user and is not for their own org. */
function inviteRefusal(invite: Invite, actor: Actor): MoveRefusal | null {
  if (invite.email && invite.email.toLowerCase() !== actor.email.toLowerCase()) return 'inviteWrongEmail';
  if (invite.orgId === actor.orgId) return 'sameOrg';
  return null;
}

/** What the invite page shows a signed-in user: may they join with this account, and if not, why. */
export async function checkInviteMove(actor: Actor, token: string, now = new Date()): Promise<MoveCheck> {
  const invite = await usableInvite(token, now);
  if (!invite) return { ok: false, reason: 'inviteBad', adminEmail: null };
  const reason = inviteRefusal(invite, actor) ?? await blocker(db, actor, now);
  if (reason) return { ok: false, reason, adminEmail: await invitingAdmin(invite) };
  return { ok: true, orgName: invite.org.name, role: invite.role };
}

/**
 * Moves the user into the inviting org in one transaction: the invite is claimed, the old org is
 * re-checked under both orgs' usage locks and closed, the invite's role and client access apply as
 * for a new member, every session of the user ends (the caller then issues this browser a new one)
 * and both orgs' audit logs record it.
 */
export async function moveWithInvite(actor: Actor, token: string, now = new Date()): Promise<MoveResult> {
  const invite = await usableInvite(token, now);
  if (!invite) return { ok: false, reason: 'inviteBad', adminEmail: null };
  const early = inviteRefusal(invite, actor);
  if (early) return { ok: false, reason: early, adminEmail: await invitingAdmin(invite) };

  const refused = await db.$transaction(async (tx): Promise<MoveRefusal | null> => {
    // Both locks in a fixed order, so two moves between the same orgs cannot deadlock.
    for (const orgId of [actor.orgId, invite.orgId].sort()) await lockOrgUsage(tx, orgId);
    const why = await blocker(tx, actor, now);
    if (why) return why;
    const claimed = await tx.invite.updateMany({ where: { id: invite.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (claimed.count !== 1) return 'inviteBad';
    // Access and saved views named the old org's clients.
    await tx.clientAssignment.deleteMany({ where: { userId: actor.userId } });
    await tx.savedView.deleteMany({ where: { userId: actor.userId } });
    await tx.user.update({ where: { id: actor.userId }, data: { orgId: invite.orgId, role: invite.role } });
    if (invite.role !== 'admin' && invite.clientIds.length > 0) {
      await tx.clientAssignment.createMany({ data: invite.clientIds.map((clientId) => ({ userId: actor.userId, clientId })), skipDuplicates: true });
    }
    await tx.organization.updateMany({ where: { id: actor.orgId, deletedAt: null }, data: { deletedAt: now } });
    await tx.userSession.updateMany({ where: { userId: actor.userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.auditEvent.createMany({
      data: [
        { orgId: actor.orgId, actorId: actor.userId, action: 'account.deletion_requested', payload: { purgeAfterDays: deleteAfterDays(), reason: 'joined_org', email: actor.email, joinedOrg: invite.orgId } },
        { orgId: invite.orgId, actorId: actor.userId, action: 'team.joined', payload: { role: invite.role, email: actor.email, existingAccount: true, fromOrg: actor.orgId } },
      ],
    });
    return null;
  });
  if (refused) return { ok: false, reason: refused, adminEmail: refused === 'inviteBad' ? null : await invitingAdmin(invite) };
  return { ok: true, orgId: invite.orgId };
}
