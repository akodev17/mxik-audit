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
 * Every query parameter as one string, the last one winning when repeated: what
 * `Object.fromEntries(searchParams)` gave the old route handlers (signed Telegram data is checked
 * over exactly these pairs, so Express's nested/array parsing must not reshape them).
 */
export function queryPairs(req: ApiRequest): Record<string, string> {
  return Object.fromEntries(new URL(req.originalUrl, 'http://local.invalid').searchParams.entries());
}
