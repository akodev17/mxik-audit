// Self-serve accounts: an org on the 14-day trial plus its first admin, and
// email confirmation when SMTP is configured.
import { absoluteUrl } from './app-url.js';
import { appDict } from '@tasnivo/i18n/i18n-app';
import type { Locale } from '@tasnivo/i18n/i18n';
import { TRIAL_DAYS } from './billing/limits.js';
import { db } from '@tasnivo/db';
import { jobs } from './jobs/dispatcher.js';
import { mailEnabled } from './mailer.js';
import { hashPassword } from './password.js';
import { MIN_PASSWORD } from './security/password-check.js';
import { sendPendingAccountLink } from './security/password-reset.js';
import { hit, RULES } from './security/rate-limit.js';
import { EMAIL_PATTERN, emailAcceptable } from './security/reserved-email.js';
import { confirmEmail, sendVerification } from './security/verification.js';

export { confirmEmail };

export type NewAccount = { userId: string; orgId: string; email: string; needsVerification: boolean };
export type SignupError = 'emailBad' | 'passwordShort' | 'emailTaken';
export type SignupResult =
  | { ok: true; account: NewAccount }
  | { ok: false; error: SignupError }
  /** SMTP is on and the address was already registered: a mail went there and nothing was created. Answer as for a new account. */
  | { ok: false; mailed: true };

type Input = {
  email: string; password: string; firmName: string;
  /** The address needs no confirmation (an account opened with Telegram). */
  verified?: boolean;
  locale?: Locale;
  /** Binds the new user's Telegram sign-in. */
  telegramUserId?: string;
};

type Existing = { id: string; email: string; emailVerifiedAt: Date | null };

/** The address is taken. With SMTP on the owner gets a mail instead of the visitor getting an answer that reveals the account. */
async function alreadyRegistered(user: Existing, input: Input): Promise<SignupResult> {
  if (input.verified || !mailEnabled()) return { ok: false, error: 'emailTaken' };
  const locale = input.locale ?? 'uz';
  if (!(await hit(RULES.resendEmail, user.email)).allowed) return { ok: false, mailed: true };
  if (user.emailVerifiedAt) {
    const s = appDict(locale).secX.mail;
    await jobs().enqueueMail({ to: user.email, subject: s.existsSubject, text: s.existsBody(absoluteUrl('/sign-in'), absoluteUrl('/sign-in/forgot')) });
  } else {
    // Not the stored password: whoever controls the mailbox sets one, so nobody can pre-register someone else's address.
    await sendPendingAccountLink(user, locale);
  }
  return { ok: false, mailed: true };
}

export async function createAccount(input: Input): Promise<SignupResult> {
  const email = input.email.trim().toLowerCase();
  const viaTelegram = input.telegramUserId !== undefined;
  // Telegram accounts get a placeholder in a reserved domain; everyone else needs an address a person can own.
  if (viaTelegram ? !EMAIL_PATTERN.test(email) : !emailAcceptable(email)) return { ok: false, error: 'emailBad' };
  if (input.password.length < MIN_PASSWORD) return { ok: false, error: 'passwordShort' };
  const name = input.firmName.replace(/\s+/g, ' ').trim().slice(0, 120) || email.split('@')[0] || 'Firma';
  // Hashing before the lookup keeps "new" and "already registered" equally slow.
  const passwordHash = await hashPassword(input.password);
  const existing = await db.user.findUnique({ where: { email }, select: { id: true, email: true, emailVerifiedAt: true } });
  if (existing) return alreadyRegistered(existing, input);

  const needsVerification = mailEnabled() && !input.verified;
  const user = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name, kind: 'customer', trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000) } });
    const created = await tx.user.create({
      data: { orgId: org.id, email, passwordHash, role: 'admin', emailVerifiedAt: needsVerification ? null : new Date(), telegramUserId: input.telegramUserId ?? null },
    });
    await tx.auditEvent.create({ data: { orgId: org.id, actorId: created.id, action: 'account.created', payload: { via: viaTelegram ? 'telegram' : 'signup' } } });
    return created;
  }).catch(() => null);
  // A parallel request took the address (or the Telegram id) first.
  if (!user) return { ok: false, error: 'emailTaken' };
  if (needsVerification) await sendVerification(user.id, email, input.locale ?? 'uz');
  return { ok: true, account: { userId: user.id, orgId: user.orgId, email, needsVerification } };
}
