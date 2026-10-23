// endpoints.auth: sign-in and sign-up, password, two-factor, sessions, e-mail confirmation (code)
// and Telegram and Google sign-in. Thin: each handler parses with the registry's schemas and calls the same
// @tasnivo/domain function as the web app's server action or route handler it replaces.
import { Body, Controller, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { endpoints, type ResponseOf } from '@tasnivo/contracts';
import { mailEnabled } from '@tasnivo/domain/mailer';
import {
  changePasswordForm, finishTwoFactor, newRecoveryCodes, securityExtras, startTelegramBind, startTwoFactor, turnOffTwoFactor,
} from '@tasnivo/domain/security/account-security';
import {
  forgotPasswordForm, resendCodeForm, resendConfirmationForm, resetPasswordForm, signInForm, twoFactorForm, verifyCodeForm, verifyEmailLink,
} from '@tasnivo/domain/security/auth-forms';
import { googleCallback, googleEnabled, startGoogle } from '@tasnivo/domain/security/google';
import { decoyResendCode, decoyVerifyCode } from '@tasnivo/domain/security/decoy';
import { deviceLabel } from '@tasnivo/domain/security/device';
import { MIN_PASSWORD } from '@tasnivo/domain/security/password-check';
import { resetTarget } from '@tasnivo/domain/security/password-reset';
import { hasPending } from '@tasnivo/domain/security/sign-in';
import { orderSessions } from '@tasnivo/domain/security/session-order';
import { endRecord, listSessions, revokeOthers, revokeSession } from '@tasnivo/domain/security/session-store';
import { twoFactorState } from '@tasnivo/domain/security/two-factor';
import type { SignedInUser, CurrentUser as User } from '@tasnivo/domain/session';
import { signUpForm } from '@tasnivo/domain/signup';
import { telegramConfig } from '@tasnivo/domain/telegram/config';
import { unbindTelegram } from '@tasnivo/domain/telegram/identity';
import { telegramBindCallback, telegramSignIn } from '@tasnivo/domain/telegram/login-callbacks';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { setLocaleCookie } from '../account/prefs';
import { SessionService } from '../auth-core/session.service';
import { CurrentUser, Locale } from '../http/decorators';
import { queryPairs, requestFacts, requestOrigin } from '../http/facts';
import type { ApiRequest } from '../http/request';
import { Route } from '../http/route';
import { ZodValidationPipe } from '../http/zod-validation.pipe';

const e = endpoints.auth;

type SignInBody = { email: string; password: string; next?: string };
type Answer<K extends keyof typeof e> = ResponseOf<(typeof e)[K]>;

/** A browser navigation: relative Location, method kept (307), as the web app's redirectTo did. */
function go(res: Response, path: string): void {
  res.redirect(307, path);
}

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  /** Open to an unconfirmed user too: the web app reads `verified` to send them to the code step. */
  @Route(e.me)
  me(@CurrentUser() user: SignedInUser): Answer<'me'> {
    return user;
  }

  @Route(e.config)
  config(): Answer<'config'> {
    const tg = telegramConfig();
    return { telegramBot: tg.enabled && tg.username ? tg.username : null, mailEnabled: mailEnabled(), google: googleEnabled() };
  }

  @Route(e.signIn)
  async signIn(
    @Body(new ZodValidationPipe(e.signIn.body)) body: SignInBody,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Answer<'signIn'>> {
    const session = await this.sessions.forSignIn(req, res);
    return signInForm(session, body, { ...requestFacts(req), rememberLocale: (locale) => setLocaleCookie(res, locale) });
  }

  @Route(e.resendConfirmation)
  resendConfirmation(@Body(new ZodValidationPipe(e.resendConfirmation.body)) body: { email: string; password: string }, @Req() req: ApiRequest): Promise<Answer<'resendConfirmation'>> {
    return resendConfirmationForm(body, requestFacts(req));
  }

  @Route(e.forgotPassword)
  forgotPassword(@Body(new ZodValidationPipe(e.forgotPassword.body)) body: { email: string }, @Req() req: ApiRequest): Promise<Answer<'forgotPassword'>> {
    return forgotPasswordForm(body.email, requestFacts(req));
  }

  @Route(e.resetTarget)
  async resetTarget(@Param(new ZodValidationPipe(e.resetTarget.params)) { token }: { token: string }): Promise<Answer<'resetTarget'>> {
    return { email: await resetTarget(token), passwordMin: MIN_PASSWORD };
  }

  @Route(e.resetPassword)
  resetPassword(
    @Param(new ZodValidationPipe(e.resetPassword.params)) { token }: { token: string },
    @Body(new ZodValidationPipe(e.resetPassword.body)) body: { password: string; repeat: string },
    @Locale() locale: LocaleCode,
  ): Promise<Answer<'resetPassword'>> {
    return resetPasswordForm(token, body, locale);
  }

  @Route(e.changePassword)
  async changePassword(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(e.changePassword.body)) body: { current: string; next: string },
    @Req() req: ApiRequest,
    @Locale() locale: LocaleCode,
  ): Promise<Answer<'changePassword'>> {
    return changePasswordForm(user, body, (await this.sessions.read(req)).sid ?? null, locale);
  }

  @Route(e.signUp)
  async signUp(
    @Body(new ZodValidationPipe(e.signUp.body)) body: { email: string; password: string; firm: string },
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Answer<'signUp'>> {
    return signUpForm(await this.sessions.forSignIn(req, res), body, requestFacts(req));
  }

  /** Works without a session too. */
  @Route(e.signOut)
  async signOut(@Req() req: ApiRequest, @Res({ passthrough: true }) res: Response): Promise<Answer<'signOut'>> {
    const { sid } = await this.sessions.read(req);
    if (sid) await endRecord(sid);
    this.sessions.clear(res);
    return { redirect: '/sign-in' };
  }

  @Route(e.verifyEmail)
  async verifyEmail(@Param(new ZodValidationPipe(e.verifyEmail.params)) { token }: { token: string }, @Req() req: ApiRequest, @Res() res: Response): Promise<void> {
    const session = await this.sessions.forSignIn(req, res);
    go(res, await verifyEmailLink(session, token, requestFacts(req).userAgent));
  }

  /** A right code renews the session (new sid in a new cookie, the old record ended), Q2. */
  @Route(e.verifyCode)
  async verifyCode(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(e.verifyCode.body)) body: { code: string },
    @Locale() locale: LocaleCode,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Answer<'verifyCode'>> {
    if (req.decoy) return decoyVerifyCode(user.userId, locale);
    const session = await this.sessions.forSignIn(req, res);
    return verifyCodeForm(user, body.code, { locale, session: { session, userAgent: requestFacts(req).userAgent } });
  }

  @Route(e.resendCode)
  resendCode(@CurrentUser() user: User, @Req() req: ApiRequest): Promise<Answer<'resendCode'>> {
    if (req.decoy) return decoyResendCode(user.email, requestFacts(req));
    return resendCodeForm(user, requestFacts(req));
  }

  /** To Google, or back to sign-in while Google sign-in is not configured. */
  @Route(e.google)
  async google(@Query(new ZodValidationPipe(e.google.query)) query: { next?: string }, @Req() req: ApiRequest, @Res() res: Response): Promise<void> {
    const session = await this.sessions.forSignIn(req, res);
    const url = await startGoogle(session, query.next, requestOrigin(req));
    if (url) res.redirect(302, url);
    else go(res, '/sign-in');
  }

  @Route(e.googleCallback)
  async googleCallback(@Req() req: ApiRequest, @Res() res: Response): Promise<void> {
    const session = await this.sessions.forSignIn(req, res);
    const facts = requestFacts(req);
    go(res, await googleCallback(session, queryPairs(req), { ip: facts.ip, userAgent: facts.userAgent, origin: requestOrigin(req) }));
  }

  @Route(e.twoFactorSubmit)
  async twoFactorSubmit(
    @Body(new ZodValidationPipe(e.twoFactorSubmit.body)) body: { code: string },
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Answer<'twoFactorSubmit'>> {
    return twoFactorForm(await this.sessions.forSignIn(req, res), body.code, requestFacts(req));
  }

  @Route(e.twoFactorPending)
  async twoFactorPending(@Req() req: ApiRequest): Promise<Answer<'twoFactorPending'>> {
    return { pending: hasPending(await this.sessions.read(req)) };
  }

  @Route(e.twoFactorState)
  twoFactorState(@CurrentUser() user: User): Promise<Answer<'twoFactorState'>> {
    return twoFactorState(user.userId);
  }

  @Route(e.twoFactorStart)
  twoFactorStart(@CurrentUser() user: User): Promise<Answer<'twoFactorStart'>> {
    return startTwoFactor(user);
  }

  @Route(e.twoFactorFinish)
  twoFactorFinish(@CurrentUser() user: User, @Body(new ZodValidationPipe(e.twoFactorFinish.body)) body: { code: string }): Promise<Answer<'twoFactorFinish'>> {
    return finishTwoFactor(user, body.code);
  }

  @Route(e.twoFactorOff)
  twoFactorOff(@CurrentUser() user: User, @Body(new ZodValidationPipe(e.twoFactorOff.body)) body: { code: string }): Promise<Answer<'twoFactorOff'>> {
    return turnOffTwoFactor(user, body.code);
  }

  @Route(e.recoveryCodes)
  recoveryCodes(@CurrentUser() user: User, @Body(new ZodValidationPipe(e.recoveryCodes.body)) body: { code: string }): Promise<Answer<'recoveryCodes'>> {
    return newRecoveryCodes(user, body.code);
  }

  @Route(e.security)
  security(@CurrentUser() user: User): Promise<Answer<'security'>> {
    return securityExtras(user);
  }

  /** Live sessions, this browser first, then the most recently active; the device label in the viewer's language. */
  @Route(e.sessions)
  async list(@CurrentUser() user: User, @Req() req: ApiRequest, @Locale() locale: LocaleCode): Promise<Answer<'sessions'>> {
    const [rows, { sid }] = await Promise.all([listSessions(user.userId), this.sessions.read(req)]);
    const unknown = i18nFor(locale).ta.security.unknownDevice;
    return orderSessions(rows, sid).map((s) => ({
      id: s.id, userAgent: s.userAgent, device: deviceLabel(s.userAgent) ?? unknown, current: s.id === sid,
      createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(),
    }));
  }

  @Route(e.endSession)
  endSession(@CurrentUser() user: User, @Param(new ZodValidationPipe(e.endSession.params)) { sid }: { sid: string }): Promise<Answer<'endSession'>> {
    return revokeSession(user, sid);
  }

  @Route(e.endOtherSessions)
  async endOtherSessions(@CurrentUser() user: User, @Req() req: ApiRequest): Promise<Answer<'endOtherSessions'>> {
    return revokeOthers(user, (await this.sessions.read(req)).sid ?? null);
  }

  @Route(e.telegramLogin)
  async telegramLogin(@Req() req: ApiRequest, @Res() res: Response): Promise<void> {
    const session = await this.sessions.forSignIn(req, res);
    go(res, await telegramSignIn(session, queryPairs(req), requestFacts(req)));
  }

  @Route(e.telegramBindStart)
  async telegramBindStart(@Req() req: ApiRequest, @Res({ passthrough: true }) res: Response): Promise<Answer<'telegramBindStart'>> {
    return startTelegramBind(await this.sessions.forSignIn(req, res));
  }

  /**
   * A browser callback: without a session it goes to sign in instead of answering 401. Manual, so
   * AccessGuard does not run: an unconfirmed user is treated as signed out (sign-in sends them on to the code step).
   */
  @Route(e.telegramBind, { session: 'manual' })
  async telegramBind(@Param(new ZodValidationPipe(e.telegramBind.params)) { state }: { state: string }, @Req() req: ApiRequest, @Res() res: Response): Promise<void> {
    const signedIn = await this.sessions.currentUser(req);
    const user = signedIn?.verified ? signedIn : null;
    const session = await this.sessions.forSignIn(req, res);
    go(res, await telegramBindCallback(session, user, state, queryPairs(req)));
  }

  @Route(e.telegramUnbind)
  telegramUnbind(@CurrentUser() user: User): Promise<Answer<'telegramUnbind'>> {
    return unbindTelegram(user);
  }
}
