'use server';

import type { Locale } from '@tasnivo/i18n/i18n';
import { getI18n } from '@/lib/locale';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isDemoOrg } from '@/lib/demo';
import { formText } from '@tasnivo/domain/form';
import { admin } from '@/lib/guard';
import { requestFacts } from '@/lib/request-facts';
import { getSession, type CurrentUser } from '@/lib/session';
import {
  inviteMemberForm, joinWithInviteForm, removeMemberForm, resendInviteForm, revokeInviteForm, updateMemberForm,
  type InviteState, type TeamResult,
} from '@tasnivo/domain/team-forms';

// The rules live in @tasnivo/domain/team-forms, shared with the API.
export type { InviteState, TeamResult };

/** A signed-in admin of a real (non-demo) org: every team change goes through this. */
async function teamAdmin(): Promise<CurrentUser | null> {
  const user = await admin();
  return user && !(await isDemoOrg(user.orgId)) ? user : null;
}

/** Runs a team change for an admin of a real org; refreshes the team page when it went through. */
async function asTeamAdmin<T>(job: (user: CurrentUser, locale: Locale) => Promise<T>, refused: (error: string) => T): Promise<T> {
  const { t, locale } = await getI18n();
  const user = await teamAdmin();
  if (!user) return refused(t.errorGeneric);
  const result = await job(user, locale);
  revalidatePath('/team');
  return result;
}

const fail = (error: string): TeamResult => ({ ok: false, error });

/** Admin creates an invite: bound to an email address (preferred) or a link anyone holding it can use. */
export async function inviteMember(_prev: InviteState, form: FormData): Promise<InviteState> {
  return asTeamAdmin((user, locale) => inviteMemberForm(user, {
    role: form.get('role'), kind: form.get('kind'), access: form.get('access'), email: formText(form, 'email'), clientIds: form.getAll('clientIds'),
  }, locale), (error) => ({ error }));
}

/** Changes a member's role and client access. The last admin cannot be demoted. */
export async function updateMember(payload: unknown): Promise<TeamResult> {
  return asTeamAdmin((user, locale) => updateMemberForm(user, payload, locale), fail);
}

/** Removes a member: their sessions end, the Telegram chats they linked are unlinked, their pending invites die. */
export async function removeMember(userId: unknown): Promise<TeamResult> {
  return asTeamAdmin((user, locale) => removeMemberForm(user, userId, locale), fail);
}

export async function revokeInvite(inviteId: unknown): Promise<TeamResult> {
  return asTeamAdmin((user, locale) => revokeInviteForm(user, inviteId, locale), fail);
}

/** Sends a pending or expired email invite again, as a new invite (the stored token is only a hash). */
export async function resendInvite(inviteId: unknown): Promise<TeamResult> {
  return asTeamAdmin((user, locale) => resendInviteForm(user, inviteId, locale), fail);
}

export type JoinState = { error?: string };

/** Public: accepts an invite, creates the account and signs it in. */
export async function joinWithInvite(token: string, _prev: JoinState, form: FormData): Promise<JoinState> {
  const result = await joinWithInviteForm(await getSession(), token, { email: formText(form, 'email'), password: formText(form, 'password') }, await requestFacts());
  if ('redirect' in result) redirect(result.redirect);
  return result;
}
