'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getI18n } from '@/lib/locale';
import { db } from '@/lib/db';
import { isDemoOrg } from '@/lib/demo';
import { admin } from '@/lib/guard';
import { createRateLimiter, clientKey } from '@/lib/lead-guard';
import { verifyPassword } from '@/lib/password';
import { requestDeletion, restoreAccount, setRetention } from '@/lib/security/account';
import { isLive, revokeOthers, revokeSession } from '@/lib/security/session-store';
import { completePending } from '@/lib/security/sign-in';
import { beginSetup, confirmSetup, disable, regenerateRecovery } from '@/lib/security/two-factor';
import { currentUser, getSession } from '@/lib/session';

const attempts = createRateLimiter({ limit: 10, windowMs: 10 * 60_000 });
const Code = z.string().trim().min(6).max(32);

export type TwoFactorLoginState = { error?: string };

/** Second step of sign-in: the authenticator code or a recovery code. */
export async function submitTwoFactor(_prev: TwoFactorLoginState, form: FormData): Promise<TwoFactorLoginState> {
  const { ta } = await getI18n();
  if (!attempts.hit(clientKey(await headers())).allowed) return { error: ta.msg.tooManyAttempts };
  const code = Code.safeParse(form.get('code'));
  const next = code.success ? await completePending(code.data) : null;
  if (!next) return { error: ta.security.codeWrong };
  redirect(next);
}

/** A signed-in, non-demo user; null otherwise. */
async function member() {
  const user = await currentUser();
  return user && !(await isDemoOrg(user.orgId)) ? user : null;
}

export async function startTwoFactor(): Promise<{ secret: string; uri: string } | null> {
  const user = await member();
  return user ? beginSetup(user.userId, user.email) : null;
}

export async function finishTwoFactor(code: unknown): Promise<string[] | null> {
  const user = await member();
  const parsed = Code.safeParse(code);
  if (!user || !parsed.success || !attempts.hit(`2fa-setup:${user.userId}`).allowed) return null;
  const codes = await confirmSetup(user, parsed.data);
  revalidatePath('/settings');
  return codes;
}

export async function turnOffTwoFactor(code: unknown): Promise<boolean> {
  const user = await member();
  const parsed = Code.safeParse(code);
  if (!user || !parsed.success || !attempts.hit(`2fa-off:${user.userId}`).allowed) return false;
  const ok = await disable(user, parsed.data);
  revalidatePath('/settings');
  return ok;
}

export async function newRecoveryCodes(code: unknown): Promise<string[] | null> {
  const user = await member();
  const parsed = Code.safeParse(code);
  if (!user || !parsed.success || !attempts.hit(`2fa-recovery:${user.userId}`).allowed) return null;
  const codes = await regenerateRecovery(user.userId, parsed.data);
  revalidatePath('/settings');
  return codes;
}

export async function endSession(sid: unknown): Promise<boolean> {
  const user = await member();
  const id = z.string().min(1).safeParse(sid);
  if (!user || !id.success) return false;
  const ok = await revokeSession(user, id.data);
  revalidatePath('/settings');
  return ok;
}

export async function endOtherSessions(): Promise<number> {
  const user = await member();
  if (!user) return 0;
  const count = await revokeOthers(user, (await getSession()).sid ?? null);
  revalidatePath('/settings');
  return count;
}

export async function changeRetention(days: unknown): Promise<boolean> {
  const user = await admin();
  const parsed = z.union([z.number().int(), z.null()]).safeParse(days);
  if (!user || !parsed.success || await isDemoOrg(user.orgId)) return false;
  const ok = await setRetention(user, parsed.data);
  revalidatePath('/settings');
  return ok;
}

export type DeleteState = { error?: string };

/** Closes the account after the admin repeats the password; the browser is signed out. */
export async function closeAccount(_prev: DeleteState, form: FormData): Promise<DeleteState> {
  const { ta } = await getI18n();
  const user = await admin();
  if (!user || await isDemoOrg(user.orgId)) return { error: ta.security.deleteFailed };
  if (!attempts.hit(`delete:${user.userId}`).allowed) return { error: ta.msg.tooManyAttempts };
  const row = await db.user.findUnique({ where: { id: user.userId }, select: { passwordHash: true } });
  const password = form.get('password');
  if (!row || typeof password !== 'string' || !(await verifyPassword(password, row.passwordHash))) return { error: ta.security.passwordWrong };
  if (!(await requestDeletion(user))) return { error: ta.security.deleteFailed };
  (await getSession()).destroy();
  redirect('/sign-in?error=closed');
}

/** From the closed-account page: an admin of the closed org reopens it. */
export async function reopenAccount(): Promise<void> {
  const session = await getSession();
  if (!session.userId || !session.orgId || !session.sid || !(await isLive(session.sid, session.userId))) redirect('/sign-in');
  const user = await db.user.findFirst({ where: { id: session.userId, orgId: session.orgId, role: 'admin' }, select: { id: true } });
  if (user && await restoreAccount({ userId: user.id, orgId: session.orgId })) redirect('/dashboard');
  redirect('/account-deleted');
}
