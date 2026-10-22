// Sign-in, sign-out and "who am I" over the domain services. Mirrors the web app's signIn action
// (apps/web/src/app/actions/auth.ts): same validation, the same DB-backed rate limits, the same
// messages in the request's language, and @tasnivo/domain/security/sign-in for the session itself.
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { mailEnabled } from '@tasnivo/domain/mailer';
import { passwordMatches } from '@tasnivo/domain/security/password-check';
import { clearAttempts, hit, minutesOf, RULES } from '@tasnivo/domain/security/rate-limit';
import { safeNext } from '@tasnivo/domain/security/safe-next';
import { endRecord } from '@tasnivo/domain/security/session-store';
import { openSession, TWO_FACTOR_PATH, type SignInSession } from '@tasnivo/domain/security/sign-in';
import type { CurrentUser } from '@tasnivo/domain/session';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { PrismaService } from '../db/prisma.service';
import { ApiError } from '../http/errors';
import type { SignInBody } from './dto';

const Credentials = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export type SignInContext = { ip: string; userAgent: string | null; locale: Locale; session: SignInSession };
export type SignedIn = { next: string; twoFactor: boolean; /** The user's saved interface language, to restore in the locale cookie. */ locale: string | null };

const tooMany = (retryAfterMs: number, message: string): ApiError =>
  new ApiError(429, 'rate_limited', message, { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) });

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async signIn(body: SignInBody, { ip, userAgent, locale, session }: SignInContext): Promise<SignedIn> {
    const { t, ta } = i18nFor(locale);
    // Never distinguish "no such user" from "wrong password".
    const wrong = () => new ApiError(401, 'invalid_credentials', t.signInError);
    const parsed = Credentials.safeParse({ email: body.email.trim().toLowerCase(), password: body.password });
    if (!parsed.success) throw wrong();
    const { email, password } = parsed.data;

    const byIp = await hit(RULES.signInIp, ip);
    if (!byIp.allowed) throw tooMany(byIp.retryAfterMs, ta.secX.tooMany(minutesOf(byIp.retryAfterMs)));
    // Counted before the check, so parallel guesses cannot slip past the limit; the right password clears it.
    const byEmail = await hit(RULES.passwordEmail, email);
    if (!byEmail.allowed) throw tooMany(byEmail.retryAfterMs, ta.secX.passwordCooldown(minutesOf(byEmail.retryAfterMs)));

    const user = await this.prisma.client.user.findUnique({ where: { email } });
    if (!user || !(await passwordMatches(user, password))) throw wrong();
    await clearAttempts(RULES.passwordEmail, email);

    // With SMTP configured, the address must be confirmed first.
    if (mailEnabled() && !user.emailVerifiedAt) throw new ApiError(403, 'unverified', ta.msg.verifyNeeded, {}, { unverified: true });

    const next = await openSession(session, user, { via: 'password', landing: safeNext(body.next) ?? '/dashboard' }, userAgent);
    if (!next) throw wrong();
    return { next, twoFactor: next === TWO_FACTOR_PATH, locale: user.locale };
  }

  /** Ends the server-side record behind the cookie, if any; the caller clears the cookie. */
  async signOut(sid: string | undefined): Promise<void> {
    if (sid) await endRecord(sid);
  }

  async me(user: CurrentUser, locale: Locale) {
    const org = await this.prisma.client.organization.findUnique({
      where: { id: user.orgId },
      select: { id: true, name: true, kind: true, expiresAt: true, deletedAt: true },
    });
    if (!org) throw new ApiError(401, 'unauthorized', 'Sign in to continue.');
    return { user, org, role: user.role, clientIds: user.clientIds, locale };
  }
}
