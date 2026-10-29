// Members, roles and client access, invites (create, resend, revoke) and joining with one.
import { z } from 'zod';
import { Fail, Id, IsoDateTime, Ok, QueryFlag, Redirect, ROLES, ShortId } from '../common';
import { defineModule, endpoint } from '../endpoint';
import { ErrorState } from './auth';

const Role = z.enum(ROLES);
const Access = z.enum(['all', 'selected']);
const TeamResult = z.union([Ok, Fail]);

/** actions/team.ts InviteState. */
export const InviteState = z.object({
  error: z.string().optional(),
  fieldErrors: z.object({ email: z.string().optional(), clients: z.string().optional() }).optional(),
  url: z.string().optional(),
  /** null when the invite is a link without an address. */
  email: z.string().nullable().optional(),
  emailed: z.boolean().optional(),
  /** The address already has an account somewhere (the org is never named): what that means for joining. */
  existingAccount: z.string().optional(),
});

/** Why a signed-in user cannot join with their account, and whom to ask. */
const JoinRefused = z.object({ error: z.string(), adminEmail: z.string().nullable() });
const TokenParams = z.object({ token: z.string() });

export const team = defineModule('team', {
  list: endpoint({
    method: 'GET', path: '/api/team', auth: 'session', role: 'any',
    summary: 'Members, open invites, the clients they can be given and the seat allowance',
    responds: 'json',
    response: z.object({
      /** lastSeenAt: the latest activity of any of the member's sessions; null before the first sign-in. */
      members: z.array(z.object({ id: z.string(), email: z.string(), role: Role, clientIds: z.array(z.string()), lastSeenAt: IsoDateTime.nullable().optional() })),
      invites: z.array(z.object({ id: z.string(), email: z.string().nullable(), role: Role, clientIds: z.array(z.string()), expiresAt: IsoDateTime })),
      clients: z.array(z.object({ id: z.string(), name: z.string(), archived: z.boolean() })),
      /** A seat is free for one more invite. */
      seatsOpen: z.boolean(),
      mailEnabled: z.boolean(),
      inviteDays: z.number().int(),
    }),
    replaces: ['page:(app)/team'],
    notes: 'Only an admin of a real (non-demo) org gets the lists; anyone else gets empty ones, as the page read nothing for them. Shape confirmed in W2; until W3 team/page.tsx queries db.user, db.client and db.invite itself.',
  }),
  invite: endpoint({
    method: 'POST', path: '/api/team/invites', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Invite by e-mail (preferred) or create a link anyone holding it can use',
    body: z.object({
      role: z.string().max(20),
      kind: z.string().max(10),
      access: z.string().max(10).optional(),
      email: z.string().max(200).optional(),
      clientIds: z.array(Id).max(500).optional(),
    }),
    responds: 'json', response: InviteState,
    replaces: ['action:team.ts#inviteMember'],
    notes: 'role/kind/access are checked by the handler (admin|accountant|viewer, email|link, all|selected) so a bad value answers { error } as before.',
  }),
  updateMember: endpoint({
    method: 'PATCH', path: '/api/team/members/{userId}', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Change a member\'s role and client access (the last admin cannot be demoted)',
    params: z.object({ userId: Id }),
    body: z.object({ role: Role, access: Access, clientIds: z.array(Id).max(500) }),
    responds: 'json', response: TeamResult,
    replaces: ['action:team.ts#updateMember'],
  }),
  removalCheck: endpoint({
    method: 'GET', path: '/api/team/members/{userId}/removal', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Before a removal: the member\'s open reviews and who could take them all',
    params: z.object({ userId: Id }),
    responds: 'json',
    response: z.object({ openReviews: z.number().int(), reassignTo: z.array(z.object({ id: z.string(), email: z.string() })) }).nullable(),
    replaces: ['page:(app)/team#removal'],
    notes: 'null for a member of another org or one already removed.',
  }),
  removeMember: endpoint({
    method: 'DELETE', path: '/api/team/members/{userId}', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Remove a member: sessions end, their Telegram chats unlink, their invites die, their open reviews are handed over or dropped',
    params: z.object({ userId: Id }),
    /** Needed only when the member holds open reviews: hand them to another member, or drop them on purpose. */
    query: z.object({ reassignTo: ShortId.optional(), dropReviews: QueryFlag.optional() }),
    responds: 'json', response: z.union([Ok, Fail.extend({ openReviews: z.number().int().optional() })]),
    replaces: ['action:team.ts#removeMember'],
    notes: 'A member with open reviews and neither field answers { ok: false, error, openReviews }.',
  }),
  revokeInvite: endpoint({
    method: 'DELETE', path: '/api/team/invites/{inviteId}', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Revoke an open invite',
    params: z.object({ inviteId: Id }),
    responds: 'json', response: TeamResult,
    replaces: ['action:team.ts#revokeInvite'],
  }),
  resendInvite: endpoint({
    method: 'POST', path: '/api/team/invites/{inviteId}/resend', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Send a pending or expired e-mail invite again (as a new invite)',
    params: z.object({ inviteId: Id }),
    responds: 'json', response: TeamResult,
    replaces: ['action:team.ts#resendInvite'],
  }),
  readInvite: endpoint({
    method: 'GET', path: '/api/invites/{token}', auth: 'public',
    summary: 'What an invite link opens: the org, the role, the address it is bound to',
    params: z.object({ token: z.string() }),
    responds: 'json', response: z.object({ orgName: z.string(), role: Role, email: z.string().nullable() }).nullable(),
    replaces: ['page:invite/[token]'],
  }),
  join: endpoint({
    method: 'POST', path: '/api/invites/{token}/join', auth: 'public',
    summary: 'Accept an invite: create the account (unconfirmed, the e-mail code comes next) and sign it in',
    params: TokenParams,
    body: z.object({ email: z.string().max(200), password: z.string().max(200) }),
    responds: 'json', response: z.union([Redirect, ErrorState]),
    replaces: ['action:team.ts#joinWithInvite'],
    notes: 'Limited per client address (RULES.inviteJoinIp). An address that is already registered answers the same generic error as an unusable one.',
  }),
  joinCheck: endpoint({
    method: 'GET', path: '/api/invites/{token}/account', auth: 'session', role: 'any', noDemo: true,
    summary: 'Whether the signed-in user may join this invite\'s org with their account, and if not why and whom to ask',
    params: TokenParams,
    responds: 'json',
    response: z.union([z.object({ ok: z.literal(true), orgName: z.string(), role: Role }), JoinRefused.extend({ ok: z.literal(false) })]),
    replaces: ['page:invite/[token]'],
    notes: 'Plan D5: allowed when the user\'s current org has no other users, no catalogues and no running paid subscription.',
  }),
  joinWithAccount: endpoint({
    method: 'POST', path: '/api/invites/{token}/account', auth: 'session', role: 'any', noDemo: true,
    summary: 'Join the inviting org with the signed-in account; the empty org it leaves is closed',
    params: TokenParams,
    responds: 'json', response: z.union([Redirect, JoinRefused]),
    replaces: ['page:invite/[token]'],
    notes: 'One transaction: invite claimed, old org re-checked and closed (deletedAt, purged after the grace period), role and client access from the invite, every session of the user ended; this browser gets a new session in the new org.',
  }),
});
