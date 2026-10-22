import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { serialize } from 'cookie';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { LOCALE_COOKIE } from '@tasnivo/i18n/locale';
import { SessionGuard } from '../auth-core/session.guard';
import { SessionService, setCookie } from '../auth-core/session.service';
import { CurrentUser, Locale } from '../http/decorators';
import { clientIp, header, type ApiRequest } from '../http/request';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { AuthService } from './auth.service';
import { errorSchema, meResponseSchema, SignInBody, signInBodySchema, signInResponseSchema, type SignInResponse } from './dto';

const LOCALE_MAX_AGE = 60 * 60 * 24 * 365;
const csrfHeader = { name: 'X-Requested-With', required: true, description: 'Must be "tasnivo" (CSRF check).' };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Post('sign-in')
  @HttpCode(200)
  @ApiOperation({ summary: 'Email and password. Sets the session cookie, or a pending two-factor state (next = /sign-in/2fa).' })
  @ApiHeader(csrfHeader)
  @ApiBody({ schema: signInBodySchema })
  @ApiResponse({ status: 200, schema: signInResponseSchema })
  @ApiResponse({ status: 401, description: 'invalid_credentials', schema: errorSchema })
  @ApiResponse({ status: 403, description: 'unverified (address not confirmed; body also has unverified: true) or csrf', schema: errorSchema })
  @ApiResponse({ status: 429, description: 'rate_limited (per address and per e-mail); Retry-After in seconds', schema: errorSchema })
  async signIn(
    @Body(new ZodValidationPipe(SignInBody)) body: SignInBody,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Locale() locale: LocaleCode,
  ): Promise<SignInResponse> {
    const session = await this.sessions.forSignIn(req, res);
    const done = await this.auth.signIn(body, { ip: clientIp(req), userAgent: header(req, 'user-agent'), locale, session });
    if (done.locale) setCookie(res, LOCALE_COOKIE, serialize(LOCALE_COOKIE, done.locale, { maxAge: LOCALE_MAX_AGE, path: '/', sameSite: 'lax' }));
    return { ok: true, next: done.next, twoFactor: done.twoFactor };
  }

  @Post('sign-out')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ends this browser\'s session record and clears the cookie. Succeeds without a session too.' })
  @ApiHeader(csrfHeader)
  @ApiResponse({ status: 200, schema: { type: 'object', properties: { ok: { type: 'boolean' }, next: { type: 'string' } } } })
  async signOut(@Req() req: ApiRequest, @Res({ passthrough: true }) res: Response): Promise<{ ok: true; next: string }> {
    const { sid } = await this.sessions.read(req);
    await this.auth.signOut(sid);
    this.sessions.clear(res);
    return { ok: true, next: '/sign-in' };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @ApiCookieAuth('session')
  @ApiOperation({ summary: 'The signed-in user, the org, role, client scope and interface language.' })
  @ApiResponse({ status: 200, schema: meResponseSchema })
  @ApiResponse({ status: 401, description: 'unauthorized', schema: errorSchema })
  me(@CurrentUser() user: User, @Locale() locale: LocaleCode) {
    return this.auth.me(user, locale);
  }
}
