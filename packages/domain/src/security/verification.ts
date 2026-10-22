// Confirming an e-mail address: the link, its check, and sending it again on request.
import { absoluteUrl } from '../app-url.js';
import { db } from '@tasnivo/db';
import { appDict } from '@tasnivo/i18n/i18n-app';
import type { Locale } from '@tasnivo/i18n/i18n';
import { mailEnabled, sendMail } from '../mailer.js';
import { claimToken, issueToken } from './email-token.js';
import { passwordMatches } from './password-check.js';

export const VERIFY_HOURS = 48;

export async function sendVerification(userId: string, email: string, locale: Locale): Promise<boolean> {
  const ta = appDict(locale);
  const token = await issueToken(userId, 'verify', VERIFY_HOURS * 3_600_000);
  return sendMail({ to: email, subject: ta.msg.mail.verifySubject, text: ta.msg.mail.verifyBody(absoluteUrl(`/verify/${token}`), VERIFY_HOURS) });
}

/** Marks the address confirmed; the user to sign in, or null for a bad, used or non-verify link. */
export async function confirmEmail(token: string): Promise<{ userId: string; orgId: string; email: string } | null> {
  const userId = await claimToken(token, 'verify');
  if (!userId) return null;
  const user = await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() }, select: { id: true, orgId: true, email: true } });
  return { userId: user.id, orgId: user.orgId, email: user.email };
}

/**
 * Sends a new confirmation link when the e-mail and password match an unconfirmed account.
 * The caller answers the same way whatever happens here, so nothing tells which addresses exist.
 */
export async function resendVerification(email: string, password: string, locale: Locale): Promise<void> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, email: true, passwordHash: true, emailVerifiedAt: true } });
  if (!(await passwordMatches(user, password)) || !user || user.emailVerifiedAt || !mailEnabled()) return;
  await sendVerification(user.id, user.email, locale);
}
