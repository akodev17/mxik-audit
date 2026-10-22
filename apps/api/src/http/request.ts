// What the API hangs on an Express request, and small readers over it.
import type { Request } from 'express';
import { parse } from 'cookie';
import type { ApiCaller } from '@tasnivo/domain/api/keys';
import type { RateResult } from '@tasnivo/domain/api/limits';
import { clientIp as clientIpFrom } from '@tasnivo/domain/security/client-ip';
import type { CurrentUser } from '@tasnivo/domain/session';
import type { Locale } from '@tasnivo/i18n/i18n';
import { LOCALE_COOKIE, parseLocale } from '@tasnivo/i18n/locale';

export type ApiRequest = Request & {
  /** Set by SessionGuard (a user) and OptionalSessionGuard (a user or null). */
  user?: CurrentUser | null;
  /** Set by LocaleInterceptor; read through requestLocale(). */
  locale?: Locale;
  /** Set by ApiKeyGuard on /api/v1 routes. */
  apiCaller?: ApiCaller;
  apiRate?: RateResult;
  /** Parsed Cookie header, filled on first read. */
  parsedCookies?: Record<string, string | undefined>;
};

export function readCookie(req: ApiRequest, name: string): string | undefined {
  req.parsedCookies ??= parse(req.headers.cookie ?? '');
  return req.parsedCookies[name];
}

/** The interface language from the mxik_locale cookie (default uz), read once per request. */
export function requestLocale(req: ApiRequest): Locale {
  req.locale ??= parseLocale(readCookie(req, LOCALE_COOKIE));
  return req.locale;
}

export function header(req: Request, name: string): string | null {
  return req.get(name) ?? null;
}

/**
 * The client address for rate limits: the proxy's X-Real-IP / X-Forwarded-For rule from
 * @tasnivo/domain/security/client-ip, or the socket's address when no proxy header is present
 * (the API reached directly in development).
 */
export function clientIp(req: Request): string {
  const ip = clientIpFrom({ get: (name) => header(req, name) });
  return ip === 'unknown' ? (req.socket.remoteAddress ?? 'unknown') : ip;
}

export const isPublicApi = (path: string): boolean => path === '/api/v1' || path.startsWith('/api/v1/');
