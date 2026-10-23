// Invite links. Only a hash of the token is stored; the link is shown once.
import { createHash, randomBytes } from 'node:crypto';
import { isOrgAdmin } from './actor-role';
import { absoluteUrl } from './app-url';
import { appDict } from '@tasnivo/i18n/i18n-app';
import type { Locale } from '@tasnivo/i18n/i18n';
import { db } from '@tasnivo/db';
import { mailDeliverable, mailEnabled, sendMail } from './mailer';
import { orgLocale } from './org-locale';
import { hashPassword } from './password';
import { MIN_PASSWORD } from './security/password-check';
import { emailAcceptable } from './security/reserved-email';
import { sendVerification } from './security/verification';
import { lockOrgUsage } from './usage-ledger';
import type { Role } from './session';

export const INVITE_DAYS = 7;
const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

type Actor = { userId: string; orgId: string };

export type InviteRefusal = 'forbidden' | 'demo' | 'bad_clients' | 'seats';

/** Thrown for an invite the server action should already have stopped. */
export class InviteRefused extends Error {
  constructor(readonly reason: InviteRefusal) {
    super(`invite refused: ${reason}`);
  }
}

/** The requested ids when every one is an active client of the org, else null. */
async function activeClientIds(orgId: string, ids: readonly string[]): Promise<string[] | null> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await db.client.findMany({ where: { orgId, id: { in: unique }, archivedAt: null }, select: { id: true } });
  return rows.length === unique.length ? rows.map((c) => c.id) : null;
}

/** Admins of a real (non-demo, open) org only; throws InviteRefused otherwise. */
/**
 * With `seatCap` (the plan's seats limit; null = uncapped) members plus open invites are counted
 * under the org's usage lock in the transaction that adds the invite, so parallel invites cannot
 * pass the cap: InviteRefused('seats').
 */
export async function createInvite(
  actor: Actor, input: { email: string | null; role: Role; clientIds: string[]; locale?: Locale }, seatCap: number | null = null,
): Promise<{ url: string; emailed: boolean }> {
  if (!(await isOrgAdmin(actor.orgId, actor.userId))) throw new InviteRefused('forbidden');
  const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { name: true, kind: true, deletedAt: true } });
  if (!org || org.deletedAt) throw new InviteRefused('forbidden');
  if (org.kind === 'demo' || org.kind === 'demo_template') throw new InviteRefused('demo');
  // Refused rather than filtered: dropping every id would turn a scoped invite into an all-clients one.
  const owned = await activeClientIds(actor.orgId, input.clientIds);
  if (!owned) throw new InviteRefused('bad_clients');
  const token = randomBytes(24).toString('base64url');
  await db.$transaction(async (tx) => {
    if (seatCap !== null) {
      await lockOrgUsage(tx, actor.orgId);
      const [users, invites] = await Promise.all([
        tx.user.count({ where: { orgId: actor.orgId } }),
        tx.invite.count({ where: { orgId: actor.orgId, usedAt: null, expiresAt: { gt: new Date() } } }),
      ]);
      if (users + invites >= seatCap) throw new InviteRefused('seats');
    }
    await tx.invite.create({
      data: {
        orgId: actor.orgId, tokenHash: hash(token), email: input.email, role: input.role, clientIds: owned,
        createdBy: actor.userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      },
    });
  });
  await db.auditEvent.create({
    data: { orgId: actor.orgId, actorId: actor.userId, action: 'team.invited', payload: { role: input.role, email: input.email, clients: owned.length } },
  });
  const url = absoluteUrl(`/invite/${token}`);
  const ta = appDict(input.locale ?? 'uz');
  const emailed = input.email && mailEnabled()
    ? await sendMail({ to: input.email, subject: ta.msg.mail.inviteSubject(org.name), text: ta.msg.mail.inviteBody(org.name, url, INVITE_DAYS) })
    : false;
  return { url, emailed };
}

export type InviteView = { orgName: string; role: Role; email: string | null };

/** The invite behind a token, when it is still usable. */
export async function readInvite(token: string): Promise<InviteView | null> {
  const invite = await db.invite.findUnique({ where: { tokenHash: hash(token) }, include: { org: { select: { name: true } } } });
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) return null;
  return { orgName: invite.org.name, role: invite.role, email: invite.email };
}

export type InviteError = 'inviteBad' | 'inviteWrongEmail' | 'emailBad' | 'passwordShort' | 'emailTaken' | 'inviteUsed';
export type AcceptResult = { ok: true; userId: string; orgId: string; email: string } | { ok: false; error: InviteError };

/**
 * An invite sent to an address confirms that address (the admin chose it); a link without one
 * lets the person type any address, so it is confirmed with a mailed code.
 */
export async function acceptInvite(token: string, emailInput: string, password: string): Promise<AcceptResult> {
  const invite = await db.invite.findUnique({ where: { tokenHash: hash(token) } });
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) return { ok: false, error: 'inviteBad' };
  const email = (invite.email ?? emailInput).trim().toLowerCase();
  if (invite.email && emailInput.trim().toLowerCase() !== invite.email.toLowerCase()) {
    return { ok: false, error: 'inviteWrongEmail' };
  }
  if (!emailAcceptable(email)) return { ok: false, error: 'emailBad' };
  if (password.length < MIN_PASSWORD) return { ok: false, error: 'passwordShort' };
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) return { ok: false, error: 'emailTaken' };

  const passwordHash = await hashPassword(password);
  const emailBound = invite.email !== null;
  const user = await db.$transaction(async (tx) => {
    // The claim is atomic, so one link creates one account.
    const claimed = await tx.invite.updateMany({ where: { id: invite.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new Error('used');
    const created = await tx.user.create({ data: { orgId: invite.orgId, email, passwordHash, role: invite.role, emailVerifiedAt: emailBound ? new Date() : null } });
    if (invite.role !== 'admin' && invite.clientIds.length > 0) {
      await tx.clientAssignment.createMany({ data: invite.clientIds.map((clientId) => ({ userId: created.id, clientId })), skipDuplicates: true });
    }
    await tx.auditEvent.create({ data: { orgId: invite.orgId, actorId: created.id, action: 'team.joined', payload: { role: invite.role, email } } });
    return created;
  }).catch(() => null);
  if (!user) return { ok: false, error: 'inviteUsed' };
  // The address must be confirmed with the mailed code before anything opens (AccessGuard).
  if (!emailBound && mailDeliverable()) await sendVerification(user.id, email, await orgLocale(user.orgId));
  return { ok: true, userId: user.id, orgId: user.orgId, email };
}
