// The team page's forms and data: invites (create, resend, revoke), member changes and removal,
// joining with an invite, and what the page lists. Shared by the web app's server actions and the
// API, so both answer with the same messages in the user's language. The caller has checked that
// the actor is a signed-in admin of a real (non-demo) org; the library functions re-check the role.
import { z } from 'zod';
import { db } from '@tasnivo/db';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { checkInviteMove, moveWithInvite, type MoveRefusal } from './invite-move.js';
import { acceptInvite, createInvite, INVITE_DAYS, InviteRefused } from './invites.js';
import { mailDeliverable, mailEnabled } from './mailer.js';
import { allows, planStatus } from './plan.js';
import { hit, minutesOf, RULES } from './security/rate-limit.js';
import { openSession, renewSession, type SignInSession } from './security/sign-in.js';
import type { CurrentUser, Role } from './session.js';
import { changeMember, ownedClientIds, removeTeamMember, revokeTeamInvite } from './team-members.js';

const RoleSchema = z.enum(['admin', 'accountant', 'viewer']);
const AccessSchema = z.enum(['all', 'selected']);
const IdSchema = z.string().min(1);

type Admin = Pick<CurrentUser, 'userId' | 'orgId' | 'role'>;

export type TeamResult = { ok: true } | { ok: false; error: string };

export type InviteState = {
  error?: string;
  fieldErrors?: { email?: string; clients?: string };
  url?: string;
  /** null when the invite is a link without an address. */
  email?: string | null;
  emailed?: boolean;
  /** The address already has a Tasnivo account (in some org, never named): how that person joins. */
  existingAccount?: string;
};

/** The invite form's fields as the form sent them; role, kind and access are checked here so a bad value answers { error }. */
export type InviteInput = { role: unknown; kind: unknown; access?: unknown; email?: unknown; clientIds?: readonly unknown[] };

/** An invite bound to an e-mail address (preferred) or a link anyone holding it can use. */
export async function inviteMemberForm(user: Admin, input: InviteInput, locale: Locale): Promise<InviteState> {
  const { ta } = i18nFor(locale);
  const s = ta.setX.team;
  const role = RoleSchema.safeParse(input.role);
  const kind = z.enum(['email', 'link']).safeParse(input.kind);
  const access = AccessSchema.safeParse(input.access ?? 'all');
  if (!role.success || !kind.success || !access.success) return { error: s.errors.invalid };

  let email: string | null = null;
  if (kind.data === 'email') {
    const parsed = z.string().trim().email().max(200).safeParse(typeof input.email === 'string' ? input.email : '');
    if (!parsed.success) return { fieldErrors: { email: s.invite.emailBad } };
    email = parsed.data.toLowerCase();
    if (await db.user.findFirst({ where: { orgId: user.orgId, email }, select: { id: true } })) return { fieldErrors: { email: s.invite.memberExists } };
    const pending = await db.invite.findFirst({ where: { orgId: user.orgId, email, usedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
    if (pending) return { fieldErrors: { email: s.invite.pendingExists } };
  }

  const scoped = role.data !== 'admin' && access.data === 'selected';
  const requested = (input.clientIds ?? []).filter((v): v is string => typeof v === 'string');
  const clientIds = scoped ? await ownedClientIds(user.orgId, requested) : [];
  if (scoped && clientIds.length === 0) return { fieldErrors: { clients: s.pickClient } };

  const status = await planStatus(user.orgId);
  const allowed = allows(status, 'seats');
  if (!allowed.ok) return { error: allowed.reason === 'expired' ? ta.msg.gate.expired : s.invite.seatsFull };

  try {
    // The cap again, counted under the org's lock: two invites sent at once cannot both take the last seat.
    const result = await createInvite(user, { email, role: role.data, clientIds, locale }, status.limits.seats);
    // Registered elsewhere (this org was checked above): they join with that account, if it can move (D5).
    const registered = email !== null && (await db.user.findUnique({ where: { email }, select: { id: true } })) !== null;
    return { url: result.url, email, emailed: result.emailed, ...(registered ? { existingAccount: s.invite.existingAccount } : {}) };
  } catch (error) {
    if (error instanceof InviteRefused && error.reason === 'seats') return { error: s.invite.seatsFull };
    throw error;
  }
}

/** Changes a member's role and client access. The last admin cannot be demoted. */
export async function updateMemberForm(user: Admin, payload: unknown, locale: Locale): Promise<TeamResult> {
  const errors = i18nFor(locale).ta.setX.team.errors;
  const parsed = z.object({
    userId: IdSchema,
    role: RoleSchema,
    access: AccessSchema,
    clientIds: z.array(IdSchema).max(500),
  }).safeParse(payload);
  if (!parsed.success) return { ok: false, error: errors.invalid };
  const result = await changeMember(user, parsed.data);
  return result.ok ? { ok: true } : { ok: false, error: errors[result.reason] };
}

/** Removes a member: their sessions end, the Telegram chats they linked are unlinked, their pending invites die. */
export async function removeMemberForm(user: Admin, userId: unknown, locale: Locale): Promise<TeamResult> {
  const errors = i18nFor(locale).ta.setX.team.errors;
  const id = IdSchema.safeParse(userId);
  if (!id.success) return { ok: false, error: errors.invalid };
  const result = await removeTeamMember(user, id.data);
  return result.ok ? { ok: true } : { ok: false, error: errors[result.reason] };
}

export async function revokeInviteForm(user: Admin, inviteId: unknown, locale: Locale): Promise<TeamResult> {
  const s = i18nFor(locale).ta.setX.team;
  const id = IdSchema.safeParse(inviteId);
  if (!id.success) return { ok: false, error: s.errors.invalid };
  const result = await revokeTeamInvite(user, id.data);
  return result.ok ? { ok: true } : { ok: false, error: s.pending.notFound };
}

/**
 * Sends a pending or expired email invite again. The stored token is only a hash, so the old link
 * cannot be re-sent: a new invite with the same address, role and access replaces it, and the old
 * one is deleted only once the new letter has gone out.
 */
export async function resendInviteForm(user: Admin, inviteId: unknown, locale: Locale): Promise<TeamResult> {
  const { ta } = i18nFor(locale);
  const s = ta.setX.team;
  const id = IdSchema.safeParse(inviteId);
  if (!id.success) return { ok: false, error: s.errors.invalid };
  const old = await db.invite.findFirst({
    where: { id: id.data, orgId: user.orgId, usedAt: null },
    select: { id: true, email: true, role: true, clientIds: true, expiresAt: true },
  });
  if (!old || !old.email) return { ok: false, error: s.pending.notFound };
  if (!mailEnabled()) return { ok: false, error: s.pending.resendFailed };
  if (await db.user.findFirst({ where: { orgId: user.orgId, email: old.email }, select: { id: true } })) return { ok: false, error: s.invite.memberExists };
  // A pending invite already holds its seat; an expired one must find one free again.
  let seatCap: number | null = null;
  if (old.expiresAt <= new Date()) {
    const status = await planStatus(user.orgId);
    const allowed = allows(status, 'seats');
    if (!allowed.ok) return { ok: false, error: allowed.reason === 'expired' ? ta.msg.gate.expired : s.invite.seatsFull };
    seatCap = status.limits.seats;
  }
  let sent: Awaited<ReturnType<typeof createInvite>>;
  try {
    sent = await createInvite(user, { email: old.email, role: old.role, clientIds: old.clientIds, locale }, seatCap);
  } catch (error) {
    if (error instanceof InviteRefused && error.reason === 'seats') return { ok: false, error: s.invite.seatsFull };
    if (error instanceof InviteRefused) return { ok: false, error: s.pending.resendFailed };
    throw error;
  }
  if (!sent.emailed) {
    // The new link was never delivered and is not shown anywhere: take it back, keep the old invite.
    const fresh = await db.invite.findFirst({ where: { orgId: user.orgId, email: old.email, usedAt: null, id: { not: old.id } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (fresh) await revokeTeamInvite(user, fresh.id);
    return { ok: false, error: s.pending.resendFailed };
  }
  await revokeTeamInvite(user, old.id);
  return { ok: true };
}

/**
 * Public: accepts an invite, creates the account (unconfirmed: the code step comes next) and signs
 * it in (`{ redirect }`). Limited per client address; an address that is already registered gets
 * the same answer as one that cannot be used, so the form does not tell which addresses exist.
 */
export async function joinWithInviteForm(
  session: SignInSession, token: string, input: { email: string; password: string }, req: { ip: string; userAgent: string | null; locale: Locale },
): Promise<{ redirect: string } | { error?: string }> {
  const { ta } = i18nFor(req.locale);
  const verdict = await hit(RULES.inviteJoinIp, req.ip);
  if (!verdict.allowed) return { error: ta.secX.tooMany(minutesOf(verdict.retryAfterMs)) };
  // As at sign-up: without a way to deliver the code the account would stay locked, so none is made.
  if (!mailDeliverable()) return { error: ta.verifyX.mailOff };
  const result = await acceptInvite(token, input.email, input.password);
  if (!result.ok) return { error: result.error === 'emailTaken' ? ta.authX.invite.addressUnavailable : ta.msg.account[result.error] };
  const next = await openSession(session, { id: result.userId, orgId: result.orgId, email: result.email }, { via: 'invite', landing: '/catalogs' }, req.userAgent);
  return { redirect: next ?? '/sign-in' };
}

type Member = Pick<CurrentUser, 'userId' | 'orgId' | 'email'>;
export type JoinCheck = { ok: true; orgName: string; role: Role } | { ok: false; error: string; adminEmail: string | null };

function moveRefusal(reason: MoveRefusal, locale: Locale): string {
  const { ta } = i18nFor(locale);
  if (reason === 'inviteBad') return ta.msg.account.inviteBad;
  if (reason === 'inviteWrongEmail') return ta.msg.account.inviteWrongEmail;
  return ta.authX.invite.refused[reason];
}

/** For the invite page of a signed-in user: may they join with the account they are signed in with (D5). */
export async function joinCheckForm(user: Member, token: string, locale: Locale): Promise<JoinCheck> {
  const check = await checkInviteMove(user, token);
  return check.ok ? check : { ok: false, error: moveRefusal(check.reason, locale), adminEmail: check.adminEmail };
}

/**
 * Joins the inviting org with the signed-in account and closes the empty org it leaves (D5). Every
 * session of the user ends; this browser gets a new one in the new org (`{ redirect }`).
 */
export async function joinWithAccountForm(
  session: SignInSession, user: Member, token: string, req: { userAgent: string | null; locale: Locale },
): Promise<{ redirect: string } | { error: string; adminEmail: string | null }> {
  const moved = await moveWithInvite(user, token);
  if (!moved.ok) return { error: moveRefusal(moved.reason, req.locale), adminEmail: moved.adminEmail };
  await renewSession(session, { id: user.userId, orgId: moved.orgId, email: user.email }, 'invite', req.userAgent);
  return { redirect: '/dashboard' };
}

export type TeamOverview = {
  /** lastSeenAt: the latest activity of any of the member's sessions; null before the first sign-in. */
  members: { id: string; email: string; role: Role; clientIds: string[]; lastSeenAt: Date | null }[];
  invites: { id: string; email: string | null; role: Role; clientIds: string[]; expiresAt: Date }[];
  clients: { id: string; name: string; archived: boolean }[];
  /** A seat is free for one more invite. */
  seatsOpen: boolean;
  mailEnabled: boolean;
  inviteDays: number;
};

/**
 * What the team page shows an admin of a real org: members with their client access, open
 * invites (newest first, at most 100), every client, and whether a seat is free. Anyone else
 * gets empty lists: nothing is read for someone who may not manage the team.
 */
export async function teamOverview(user: Admin, demo: boolean): Promise<TeamOverview> {
  const base = { mailEnabled: mailEnabled(), inviteDays: INVITE_DAYS };
  if (user.role !== 'admin' || demo) return { members: [], invites: [], clients: [], seatsOpen: false, ...base };
  const [members, clients, invites, status] = await Promise.all([
    db.user.findMany({ where: { orgId: user.orgId }, orderBy: { createdAt: 'asc' }, select: { id: true, email: true, role: true, assignments: { select: { clientId: true } }, sessions: { orderBy: { lastSeenAt: 'desc' }, take: 1, select: { lastSeenAt: true } } } }),
    db.client.findMany({ where: { orgId: user.orgId }, orderBy: { name: 'asc' }, select: { id: true, name: true, archivedAt: true } }),
    db.invite.findMany({ where: { orgId: user.orgId, usedAt: null }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, email: true, role: true, clientIds: true, expiresAt: true } }),
    planStatus(user.orgId),
  ]);
  return {
    members: members.map((m) => ({ id: m.id, email: m.email, role: m.role, clientIds: m.assignments.map((a) => a.clientId), lastSeenAt: m.sessions[0]?.lastSeenAt ?? null })),
    invites,
    clients: clients.map((c) => ({ id: c.id, name: c.name, archived: c.archivedAt !== null })),
    seatsOpen: allows(status, 'seats').ok,
    ...base,
  };
}
