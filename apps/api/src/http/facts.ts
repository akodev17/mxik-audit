// Request facts the domain's forms take as arguments, and the query string of a browser callback
// read the way the web app's route handlers read it.
import type { Locale } from '@tasnivo/i18n/i18n';
import { clientIp, header, requestLocale, type ApiRequest } from './request';

export type RequestFacts = { ip: string; userAgent: string | null; locale: Locale };

/** Client address (X-Real-IP, else the rightmost X-Forwarded-For hop, else the socket), user agent and interface language. */
export function requestFacts(req: ApiRequest): RequestFacts {
  return { ip: clientIp(req), userAgent: header(req, 'user-agent'), locale: requestLocale(req) };
}

/**
 * The browser-facing origin of the request (the proxy's X-Forwarded-Proto/Host, else Host): the
 * fallback for OAuth redirect URIs when APP_URL is unset in development. Google only accepts the
 * redirect URIs registered for the client, so a forged Host cannot send the code elsewhere.
 */
export function requestOrigin(req: ApiRequest): string | null {
  const first = (v: string | null): string | null => v?.split(',')[0]?.trim() || null;
  const host = first(header(req, 'x-forwarded-host')) ?? first(header(req, 'host'));
  if (!host || !/^[w.-]+(:d+)?$/.test(host)) return null;
  const proto = first(header(req, 'x-forwarded-proto')) ?? req.protocol;
  return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}

/**
 * Every query parameter as one string, the last one winning when repeated: what
 * `Object.fromEntries(searchParams)` gave the old route handlers (signed Telegram data is checked
 * over exactly these pairs, so Express's nested/array parsing must not reshape them).
 */
export function queryPairs(req: ApiRequest): Record<string, string> {
  return Object.fromEntries(new URL(req.originalUrl, 'http://local.invalid').searchParams.entries());
}
