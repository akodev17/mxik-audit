// Password reset by e-mail: a one-hour, single-use link. Using it sets the password,
// confirms the address (the mailbox was just proven) and ends every session of the user.
import { absoluteUrl } from '../app-url.js';
import { db } from '@tasnivo/db';
import { appDict } from '@tasnivo/i18n/i18n-app';
import type { Locale } from '@tasnivo/i18n/i18n';
import { jobs } from '../jobs/dispatcher.js';
import { hashPassword } from '../password.js';
import { claimToken, issueToken, peekToken } from './email-token.js';
import { passwordAcceptable } from './password-check.js';
import { clearAttempts, RULES } from './rate-limit.js';
import { endUserSessions } from './session-store.js';

export const RESET_MINUTES = 60;
const RESET_MS = RESET_MINUTES * 60_000;

export async function issueResetToken(userId: string, now = new Date()): Promise<string> {
  return issueToken(userId, 'reset', RESET_MS, now);
}

/** Mails a reset link when the address has an account; silent otherwise, so the caller answers the same way. */
export async function requestReset(email: string, locale: Locale): Promise<void> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, email: true } });
  if (!user) return;
  const token = await issueResetToken(user.id);
  const s = appDict(locale).secX.mail;
  await jobs().enqueueMail({ to: user.email, subject: s.resetSubject, text: s.resetBody(absoluteUrl(`/reset/${token}`), RESET_MINUTES) });
}

/** For an account that exists but was never confirmed: the link confirms it and sets a password chosen by the mailbox owner. */
export async function sendPendingAccountLink(user: { id: string; email: string }, locale: Locale): Promise<void> {
  const token = await issueResetToken(user.id);
  const s = appDict(locale).secX.mail;
  await jobs().enqueueMail({ to: user.email, subject: s.pendingSubject, text: s.pendingBody(absoluteUrl(`/reset/${token}`), RESET_MINUTES) });
}

/** The address a usable reset link belongs to, for the reset page. */
export async function resetTarget(token: string): Promise<string | null> {
  const userId = await peekToken(token, 'reset');
  if (!userId) return null;
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email ?? null;
}

export type ResetResult = { ok: true } | { ok: false; error: 'bad' | 'short' };

export async function resetPassword(token: string, password: string, now = new Date()): Promise<ResetResult> {
  if (!passwordAcceptable(password)) return { ok: false, error: 'short' };
  const passwordHash = await hashPassword(password);
  const userId = await claimToken(token, 'reset', now);
  if (!userId) return { ok: false, error: 'bad' };
  const user = await db.user.findUnique({ where: { id: userId }, select: { orgId: true, email: true, emailVerifiedAt: true, verifiedVia: true } });
  if (!user) return { ok: false, error: 'bad' };
  // The reset link reached the mailbox, so the address counts as confirmed by link from now on (S1).
  const verifiedVia = user.verifiedVia === 'code' ? 'code' : 'link';
  await db.user.update({ where: { id: userId }, data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? now, verifiedVia } });
  const ended = await endUserSessions(userId);
  await clearAttempts(RULES.passwordEmail, user.email);
  await db.auditEvent.create({ data: { orgId: user.orgId, actorId: userId, action: 'security.password_reset', targetId: userId, payload: { via: 'email', sessionsEnded: ended } } });
  return { ok: true };
}
