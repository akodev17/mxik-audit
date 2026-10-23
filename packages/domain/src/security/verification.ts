// Confirming an e-mail address: a six-digit code by mail (security/email-code.ts), its check, and
// sending a new one on request. Links from mails sent before the codes (48 hours) still confirm.
import { db } from '@tasnivo/db';
import { appDict } from '@tasnivo/i18n/i18n-app';
import type { Locale } from '@tasnivo/i18n/i18n';
import { mailDeliverable, sendMail } from '../mailer.js';
import { checkCode, CODE_MINUTES, issueCode, type CodeCheck } from './email-code.js';
import { claimToken } from './email-token.js';
import { passwordMatches } from './password-check.js';

/** Where a signed-in user with an unconfirmed address is sent: the code step. */
export const VERIFY_PATH = '/sign-up/verify';

/** Issues a new code and mails it. False when the mail could not be handed over (the user may ask again). */
export async function sendVerification(userId: string, email: string, locale: Locale): Promise<boolean> {
  const v = appDict(locale).verifyX;
  const code = await issueCode(userId);
  return sendMail({ to: email, subject: v.mailSubject(code), text: v.mailBody(code, CODE_MINUTES) });
}

/** Checks the code and, when it is right, marks the address confirmed. */
export async function confirmCode(userId: string, code: string): Promise<CodeCheck> {
  const result = await checkCode(userId, code);
  if (result === 'ok') await db.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  return result;
}

/** A link from a mail sent before the codes: marks the address confirmed; the user to sign in, or null for a bad, used or non-verify link. */
export async function confirmEmail(token: string): Promise<{ userId: string; orgId: string; email: string } | null> {
  const userId = await claimToken(token, 'verify');
  if (!userId) return null;
  const user = await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() }, select: { id: true, orgId: true, email: true } });
  return { userId: user.id, orgId: user.orgId, email: user.email };
}

/**
 * Sends a new code when the e-mail and password match an unconfirmed account.
 * The caller answers the same way whatever happens here, so nothing tells which addresses exist.
 */
export async function resendVerification(email: string, password: string, locale: Locale): Promise<void> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, email: true, passwordHash: true, emailVerifiedAt: true } });
  if (!(await passwordMatches(user, password)) || !user || user.emailVerifiedAt || !mailDeliverable()) return;
  await sendVerification(user.id, user.email, locale);
}
