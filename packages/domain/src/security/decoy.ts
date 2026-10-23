// Q3: sign-up answers a registered address exactly like a new one. The registered owner is mailed
// (signup.ts alreadyRegistered) and the visitor's browser goes to the code step with a decoy session:
// ids shaped like real ones that name no user, so /api/auth/me looks like a new unconfirmed admin,
// every other session endpoint answers 403 `unverified`, a code is always wrong and "send again"
// says it was sent. Nothing a decoy does reaches a real account.
import { randomBytes } from 'node:crypto';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import type { SessionData, SignedInUser } from '../session.js';
import { hit, minutesOf, RULES } from './rate-limit.js';
import { endRecord } from './session-store.js';
import { clearPending, type SignInSession } from './sign-in.js';

/** A cuid-shaped id (c + 24 base-36 characters) that no row has. */
function fakeId(): string {
  const digits = [...randomBytes(24)].map((b) => (b % 36).toString(36)).join('');
  return `c${digits}`;
}

/** Puts the decoy into the browser's cookie, as openSession would put a new account (the old record ends). */
export async function openDecoy(session: SignInSession, email: string): Promise<void> {
  if (session.sid) await endRecord(session.sid);
  session.sid = undefined;
  session.userId = undefined;
  session.orgId = undefined;
  session.email = undefined;
  session.demo = false;
  session.clientId = undefined;
  clearPending(session);
  session.decoy = { userId: fakeId(), orgId: fakeId(), email, at: Date.now() };
  await session.save();
}

/** The decoy as the signed-in user a new, unconfirmed admin would be; null when the cookie holds none. */
export function decoyUser(session: SessionData): SignedInUser | null {
  const d = session.decoy;
  if (!d || session.userId) return null;
  return { userId: d.userId, orgId: d.orgId, email: d.email, demo: false, clientId: null, role: 'admin', clientIds: null, verified: false };
}

/** The code step for a decoy: the same per-user limit as a real account, then "wrong code". */
export async function decoyVerifyCode(userId: string, locale: Locale): Promise<{ error: string }> {
  const { ta } = i18nFor(locale);
  const verdict = await hit(RULES.verifyCodeUser, userId);
  if (!verdict.allowed) return { error: ta.secX.tooMany(minutesOf(verdict.retryAfterMs)) };
  return { error: ta.verifyX.wrong };
}

/** "Send the code again" for a decoy: the same limits as a real account, then "sent"; nothing is mailed. */
export async function decoyResendCode(email: string, req: { ip: string; locale: Locale }): Promise<{ error?: string; info?: string }> {
  const { ta } = i18nFor(req.locale);
  for (const [rule, key] of [[RULES.resendIp, req.ip], [RULES.resendEmail, email]] as const) {
    const verdict = await hit(rule, key);
    if (!verdict.allowed) return { error: ta.secX.tooMany(minutesOf(verdict.retryAfterMs)) };
  }
  return { info: ta.verifyX.resent };
}
