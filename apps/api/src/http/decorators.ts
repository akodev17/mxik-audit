import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { CurrentUser as User } from '@tasnivo/domain/session';
import type { Locale as LocaleCode } from '@tasnivo/i18n/i18n';
import { ApiError } from './errors';
import { requestLocale, type ApiRequest } from './request';

/**
 * The signed-in user that SessionGuard resolved. On a route behind OptionalSessionGuard it may be
 * null; behind no session guard at all it throws (a wiring mistake, not a client error).
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User | null => {
  const req = ctx.switchToHttp().getRequest<ApiRequest>();
  if (req.user === undefined) throw new ApiError(500, 'server_error', '@CurrentUser() used on a route without SessionGuard or OptionalSessionGuard.');
  return req.user;
});

/** The request's interface language (mxik_locale cookie, default uz). */
export const Locale = createParamDecorator((_data: unknown, ctx: ExecutionContext): LocaleCode =>
  requestLocale(ctx.switchToHttp().getRequest<ApiRequest>()));

export const SKIP_CSRF = 'tasnivo:skip-csrf';

/**
 * Exempts a mutating route from CsrfGuard. Only for callers that are not a browser carrying the
 * session cookie: provider callbacks (Click, Payme, Telegram) and cron. /api/v1 is exempt already.
 */
export const SkipCsrf = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_CSRF, true);
