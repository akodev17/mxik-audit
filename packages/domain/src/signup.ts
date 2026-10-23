// Self-serve accounts: an org on the 14-day trial plus its first admin. A password sign-up always
// confirms its address with a mailed code before anything else opens (security/verification.ts);
// Telegram and Google accounts arrive confirmed.
import { absoluteUrl } from './app-url.js';
import { appDict } from '@tasnivo/i18n/i18n-app';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { TRIAL_DAYS } from './billing/limits.js';
import { defaultClientId } from './clients.js';
import { db } from '@tasnivo/db';
import { jobs } from './jobs/dispatcher.js';
import { mailDeliverable } from './mailer.js';
import { hashPassword } from './password.js';
import { MIN_PASSWORD } from './security/password-check.js';
import { sendPendingAccountLink } from './security/password-reset.js';
import { hit, minutesOf, RULES } from './security/rate-limit.js';
import { EMAIL_PATTERN, emailAcceptable } from './security/reserved-email.js';
import { openSession, type SignInSession } from './security/sign-in.js';
import { confirmEmail, sendVerification, VERIFY_PATH } from './security/verification.js';

export { confirmEmail };

export type NewAccount = { userId: string; orgId: string; email: string; needsVerification: boolean };
export type SignupError = 'emailBad' | 'passwordShort' | 'emailTaken';
export type SignupResult =
  | { ok: true; account: NewAccount }
  | { ok: false; error: SignupError }
  /** The address was already registered: a mail went there and nothing was created. */
  | { ok: false; mailed: true };

type Input = {
  email: string; password: string; firmName: string;
  /** The address needs no confirmation (an account opened with Telegram or a verified Google address). */
  verified?: boolean;
  locale?: Locale;
  /** Binds the new user's Telegram sign-in. */
  telegramUserId?: string;
  /** Binds the new user's Google sign-in (the ID token's sub). */
  googleSub?: string;
};

type Existing = { id: string; email: string; emailVerifiedAt: Date | null };

/** The address is taken. When mail can be delivered the owner gets a mail instead of the visitor getting an answer that names the account. */
async function alreadyRegistered(user: Existing, input: Input): Promise<SignupResult> {
  if (input.verified || !mailDeliverable()) return { ok: false, error: 'emailTaken' };
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
  const via = viaTelegram ? 'telegram' : input.googleSub !== undefined ? 'google' : 'signup';
  // Telegram accounts get a placeholder in a reserved domain; everyone else needs an address a person can own.
  if (viaTelegram ? !EMAIL_PATTERN.test(email) : !emailAcceptable(email)) return { ok: false, error: 'emailBad' };
  if (input.password.length < MIN_PASSWORD) return { ok: false, error: 'passwordShort' };
  const name = input.firmName.replace(/\s+/g, ' ').trim().slice(0, 120) || email.split('@')[0] || 'Firma';
  // Hashing before the lookup keeps "new" and "already registered" equally slow.
  const passwordHash = await hashPassword(input.password);
  const existing = await db.user.findUnique({ where: { email }, select: { id: true, email: true, emailVerifiedAt: true } });
  if (existing) return alreadyRegistered(existing, input);

  const needsVerification = !input.verified;
  const user = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name, kind: 'customer', trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000) } });
    // The org's default client exists from the start (Q4): uploads through the API work before any page was opened.
    await tx.client.create({ data: { id: defaultClientId(org.id), orgId: org.id, name, isDefault: true } });
    const created = await tx.user.create({
      data: { orgId: org.id, email, passwordHash, role: 'admin', emailVerifiedAt: needsVerification ? null : new Date(), telegramUserId: input.telegramUserId ?? null, googleSub: input.googleSub ?? null },
    });
    await tx.auditEvent.create({ data: { orgId: org.id, actorId: created.id, action: 'account.created', payload: { via } } });
    return created;
  }).catch(() => null);
  // A parallel request took the address (or the Telegram id, or the Google account) first.
  if (!user) return { ok: false, error: 'emailTaken' };
  if (needsVerification) await sendVerification(user.id, email, input.locale ?? 'uz');
  return { ok: true, account: { userId: user.id, orgId: user.orgId, email, needsVerification } };
}

/**
 * The public sign-up form: opens a 14-day trial org under the per-address signup limit and signs
 * the new admin in with an unconfirmed address, so the browser goes to the code step
 * (`{ redirect: VERIFY_PATH }`); every other page stays closed until the code is entered. An
 * address that is already registered gets "check your e-mail" and its owner a mail. Without a way
 * to deliver the code (production without SMTP) sign-up is refused, never let through unconfirmed.
 */
export async function signUpForm(
  session: SignInSession,
  input: { email: string; password: string; firm: string },
  req: { ip: string; userAgent: string | null; locale: Locale },
): Promise<{ redirect: string } | { error?: string; checkEmail?: boolean }> {
  const { ta } = i18nFor(req.locale);
  const verdict = await hit(RULES.signupIp, req.ip);
  if (!verdict.allowed) return { error: ta.secX.tooMany(minutesOf(verdict.retryAfterMs)) };
  if (!mailDeliverable()) {
    console.error('[signup] refused: SMTP_URL and MAIL_FROM are not set, so the verification code cannot be sent (NODE_ENV=production).');
    return { error: ta.verifyX.mailOff };
  }
  const result = await createAccount({ email: input.email, password: input.password, firmName: input.firm, locale: req.locale });
  if (!result.ok) return 'mailed' in result ? { checkEmail: true } : { error: ta.msg.account[result.error] };
  const { userId, orgId, email } = result.account;
  const next = await openSession(session, { id: userId, orgId, email }, { via: 'signup', landing: VERIFY_PATH }, req.userAgent);
  return { redirect: next ?? '/sign-in' };
}
