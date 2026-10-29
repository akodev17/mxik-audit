// Removing a member from the team page, with the refusals the admin reads. A member who holds open
// reviews is removed only once the admin hands them to someone or drops them on purpose (F18), so
// the API's removeMember and removalCheck answer from here. The caller has checked that the actor
// is a signed-in admin of a real (non-demo) org; removeTeamMember re-checks the role.
import { z } from 'zod';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import type { CurrentUser } from './session.js';
import { memberRemovalCheck, removeTeamMember, type RemovalCheck } from './team-members.js';

type Admin = Pick<CurrentUser, 'userId' | 'orgId' | 'role'>;

export type RemoveMemberAnswer = { ok: true } | { ok: false; error: string; openReviews?: number };

const Handling = z.object({ reassignTo: z.string().min(1).max(64).optional(), dropReviews: z.boolean().optional() });

/** Removes a member; their open reviews go to `reassignTo` or, with `dropReviews`, are dropped. */
export async function removeMemberForm(user: Admin, userId: unknown, input: unknown, locale: Locale): Promise<RemoveMemberAnswer> {
  const s = i18nFor(locale).ta.setX.team;
  const id = z.string().min(1).safeParse(userId);
  const handling = Handling.safeParse(input ?? {});
  if (!id.success || !handling.success) return { ok: false, error: s.errors.invalid };
  const result = await removeTeamMember(user, id.data, handling.data);
  if (result.ok) return { ok: true };
  if (result.reason === 'open_reviews') return { ok: false, error: s.reviewsOnRemoval.blocked(result.openReviews), openReviews: result.openReviews };
  return { ok: false, error: s.errors[result.reason] };
}

/** What the removal dialog asks before it removes: the open reviews and who could take them. */
export function removalCheckFor(user: Admin, userId: string): Promise<RemovalCheck | null> {
  return memberRemovalCheck(user, userId);
}
