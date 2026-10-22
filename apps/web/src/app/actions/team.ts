'use server';

import { getI18n } from '@/lib/locale';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@tasnivo/db';
import { isDemoOrg } from '@/lib/demo';
import { formText } from '@tasnivo/domain/form';
import { admin } from '@/lib/guard';
import { acceptInvite, createInvite, InviteRefused } from '@tasnivo/domain/invites';
import { mailEnabled } from '@tasnivo/domain/mailer';
import { gate } from '@/lib/plan';
import { openSession } from '@/lib/security/sign-in';
import type { CurrentUser } from '@/lib/session';
import { changeMember, ownedClientIds, removeTeamMember, revokeTeamInvite } from '@tasnivo/domain/team-members';

const RoleSchema = z.enum(['admin', 'accountant', 'viewer']);
const AccessSchema = z.enum(['all', 'selected']);

export type TeamResult = { ok: true } | { ok: false; error: string };

/** A signed-in admin of a real (non-demo) org: every team change goes through this. */
async function teamAdmin(): Promise<CurrentUser | null> {
  const user = await admin();
  return user && !(await isDemoOrg(user.orgId)) ? user : null;
}

export type InviteState = {
  error?: string;
  fieldErrors?: { email?: string; clients?: string };
  url?: string;
  /** null when the invite is a link without an address. */
  email?: string | null;
  emailed?: boolean;
};

/** Admin creates an invite: bound to an email address (preferred) or a link anyone holding it can use. */
export async function inviteMember(_prev: InviteState, form: FormData): Promise<InviteState> {
  const { t, ta, locale } = await getI18n();
  const s = ta.setX.team;
  const user = await teamAdmin();
  if (!user) return { error: t.errorGeneric };
  const role = RoleSchema.safeParse(form.get('role'));
  const kind = z.enum(['email', 'link']).safeParse(form.get('kind'));
  const access = AccessSchema.safeParse(form.get('access') ?? 'all');
  if (!role.success || !kind.success || !access.success) return { error: s.errors.invalid };

  let email: string | null = null;
  if (kind.data === 'email') {
    const parsed = z.string().trim().email().max(200).safeParse(formText(form, 'email'));
    if (!parsed.success) return { fieldErrors: { email: s.invite.emailBad } };
    email = parsed.data.toLowerCase();
    if (await db.user.findFirst({ where: { orgId: user.orgId, email }, select: { id: true } })) return { fieldErrors: { email: s.invite.memberExists } };
    const pending = await db.invite.findFirst({ where: { orgId: user.orgId, email, usedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
    if (pending) return { fieldErrors: { email: s.invite.pendingExists } };
  }

  const scoped = role.data !== 'admin' && access.data === 'selected';
  const requested = form.getAll('clientIds').filter((v): v is string => typeof v === 'string');
  const clientIds = scoped ? await ownedClientIds(user.orgId, requested) : [];
  if (scoped && clientIds.length === 0) return { fieldErrors: { clients: s.pickClient } };

  const allowed = await gate(user.orgId, 'seats');
  if (!allowed.ok) return { error: allowed.reason === 'expired' ? ta.msg.gate.expired : s.invite.seatsFull };

  const result = await createInvite(user, { email, role: role.data, clientIds, locale });
  revalidatePath('/team');
  return { url: result.url, email, emailed: result.emailed };
}

/** Changes a member's role and client access. The last admin cannot be demoted. */
export async function updateMember(payload: unknown): Promise<TeamResult> {
  const { t, ta } = await getI18n();
  const errors = ta.setX.team.errors;
  const user = await teamAdmin();
  if (!user) return { ok: false, error: t.errorGeneric };
  const parsed = z.object({
    userId: z.string().min(1),
    role: RoleSchema,
    access: AccessSchema,
    clientIds: z.array(z.string().min(1)).max(500),
  }).safeParse(payload);
  if (!parsed.success) return { ok: false, error: errors.invalid };
  const result = await changeMember(user, parsed.data);
  if (!result.ok) return { ok: false, error: errors[result.reason] };
  revalidatePath('/team');
  return { ok: true };
}

/** Removes a member: their sessions end, the Telegram chats they linked are unlinked, their pending invites die. */
export async function removeMember(userId: unknown): Promise<TeamResult> {
  const { t, ta } = await getI18n();
  const user = await teamAdmin();
  const id = z.string().min(1).safeParse(userId);
  if (!user) return { ok: false, error: t.errorGeneric };
  if (!id.success) return { ok: false, error: ta.setX.team.errors.invalid };
  const result = await removeTeamMember(user, id.data);
  if (!result.ok) return { ok: false, error: ta.setX.team.errors[result.reason] };
  revalidatePath('/team');
  return { ok: true };
}

export async function revokeInvite(inviteId: unknown): Promise<TeamResult> {
  const { t, ta } = await getI18n();
  const user = await teamAdmin();
  const id = z.string().min(1).safeParse(inviteId);
  if (!user) return { ok: false, error: t.errorGeneric };
  if (!id.success) return { ok: false, error: ta.setX.team.errors.invalid };
  const result = await revokeTeamInvite(user, id.data);
  if (!result.ok) return { ok: false, error: ta.setX.team.pending.notFound };
  revalidatePath('/team');
  return { ok: true };
}

/**
 * Sends a pending or expired email invite again. The stored token is only a hash, so the old link
 * cannot be re-sent: a new invite with the same address, role and access replaces it, and the old
 * one is deleted only once the new letter has gone out.
 */
export async function resendInvite(inviteId: unknown): Promise<TeamResult> {
  const { t, ta, locale } = await getI18n();
  const s = ta.setX.team;
  const user = await teamAdmin();
  const id = z.string().min(1).safeParse(inviteId);
  if (!user) return { ok: false, error: t.errorGeneric };
  if (!id.success) return { ok: false, error: s.errors.invalid };
  const old = await db.invite.findFirst({
    where: { id: id.data, orgId: user.orgId, usedAt: null },
    select: { id: true, email: true, role: true, clientIds: true, expiresAt: true },
  });
  if (!old || !old.email) return { ok: false, error: s.pending.notFound };
  if (!mailEnabled()) return { ok: false, error: s.pending.resendFailed };
  if (await db.user.findFirst({ where: { orgId: user.orgId, email: old.email }, select: { id: true } })) return { ok: false, error: s.invite.memberExists };
  // A pending invite already holds its seat; an expired one must find one free again.
  if (old.expiresAt <= new Date()) {
    const allowed = await gate(user.orgId, 'seats');
    if (!allowed.ok) return { ok: false, error: allowed.reason === 'expired' ? ta.msg.gate.expired : s.invite.seatsFull };
  }
  let sent: Awaited<ReturnType<typeof createInvite>>;
  try {
    sent = await createInvite(user, { email: old.email, role: old.role, clientIds: old.clientIds, locale });
  } catch (error) {
    if (error instanceof InviteRefused) return { ok: false, error: s.pending.resendFailed };
    throw error;
  }
  if (!sent.emailed) {
    // The new link was never delivered and is not shown anywhere: take it back, keep the old invite.
    const fresh = await db.invite.findFirst({ where: { orgId: user.orgId, email: old.email, usedAt: null, id: { not: old.id } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (fresh) await revokeTeamInvite(user, fresh.id);
    revalidatePath('/team');
    return { ok: false, error: s.pending.resendFailed };
  }
  await revokeTeamInvite(user, old.id);
  revalidatePath('/team');
  return { ok: true };
}

export type JoinState = { error?: string };

/** Public: accepts an invite, creates the account and signs it in. */
export async function joinWithInvite(token: string, _prev: JoinState, form: FormData): Promise<JoinState> {
  const { ta } = await getI18n();
  const result = await acceptInvite(token, formText(form, 'email'), formText(form, 'password'));
  if (!result.ok) return { error: ta.msg.account[result.error] };
  const next = await openSession({ id: result.userId, orgId: result.orgId, email: result.email }, { via: 'invite', landing: '/catalogs' });
  redirect(next ?? '/sign-in');
}
