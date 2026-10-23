// Every error leaves the API as JSON. /api/v1 keeps the public contract's envelope and codes
// (@tasnivo/domain/api/contract); first-party routes answer `{ error: { code, message } }` plus any
// extra fields the thrower attached. Unexpected failures are logged and never leak their message.
import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_STATUS, type ApiErrorCode } from '@tasnivo/domain/api/contract';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { ApiError, codeForStatus, v1CodeForStatus } from './errors';
import { loggablePath } from './middleware';
import { isPublicApi, requestLocale, type ApiRequest } from './request';

export type ErrorResponse = { status: number; headers: Record<string, string>; body: Record<string, unknown> };

const SERVER_ERROR_MESSAGE = 'The request could not be completed. Try again later.';

const isV1Code = (code: string): code is ApiErrorCode => Object.hasOwn(ERROR_STATUS, code);

function httpMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.map(String).join('; ');
  return typeof message === 'string' ? message : exception.message;
}

/**
 * A client error raised by Express middleware before Nest saw the request: body-parser and raw-body
 * throw http-errors objects (413 over the size limit, 415 an unsupported charset, 400 a bad
 * encoding) whose message is marked safe to show (`expose`). Null for anything else.
 */
function middlewareClientError(exception: unknown): { status: number; message: string } | null {
  if (!(exception instanceof Error)) return null;
  const { status, expose } = exception as Error & { status?: unknown; expose?: unknown };
  if (expose !== true || typeof status !== 'number' || status < 400 || status >= 500) return null;
  return { status, message: exception.message };
}

/**
 * The English texts the API's generic refusals are thrown with (SessionGuard, CsrfGuard, notFound()
 * and the services' "not found"). The web app shows a 4xx message to the user as it is
 * (apps/web/src/lib/api/refusal.ts), so on first-party routes these leave in the request's language.
 */
const GENERIC_TEXTS = new Set([
  'Sign in to continue.', 'Not found.', 'not found', 'Client not found.', 'Catalogue not found.',
  'Missing header "X-Requested-With: tasnivo".', 'Cross-origin request refused.',
]);

/** The message in the reader's language for a generic refusal; any other message as it is. */
function localized(code: string, message: string, generic: boolean, locale: Locale): string {
  if (!generic && !GENERIC_TEXTS.has(message)) return message;
  const h = i18nFor(locale).ta.httpX;
  switch (code) {
    case 'unauthorized': return h.unauthorized;
    case 'not_found': return h.notFound;
    case 'too_large': return h.tooLarge;
    case 'csrf': return h.csrf;
    default: return message;
  }
}

/**
 * The status, headers and JSON body an exception becomes. With `locale`, first-party generic
 * refusals (401, 404, 413, CSRF) are worded in that language; /api/v1 stays English.
 */
export function toErrorResponse(exception: unknown, publicApi: boolean, locale?: Locale): ErrorResponse {
  let status = 500;
  let code: string | null = null;
  let message = SERVER_ERROR_MESSAGE;
  let headers: Record<string, string> = {};
  let extra: Record<string, unknown> = {};
  const middleware = middlewareClientError(exception);
  if (exception instanceof ApiError) {
    ({ status, code, headers, extra } = exception);
    message = exception.message;
  } else if (exception instanceof HttpException) {
    status = exception.getStatus();
    if (status < 500) message = httpMessage(exception);
  } else if (middleware) {
    ({ status, message } = middleware);
  }
  if (status >= 500 && !(exception instanceof ApiError)) message = SERVER_ERROR_MESSAGE;
  if (publicApi) {
    const v1 = code !== null && isV1Code(code) ? code : v1CodeForStatus(status);
    return { status, headers, body: { error: { code: v1, message } } };
  }
  const firstParty = code ?? codeForStatus(status);
  if (locale && status < 500) message = localized(firstParty, message, !(exception instanceof ApiError), locale);
  return { status, headers, body: { error: { code: firstParty, message }, ...extra } };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<ApiRequest>();
    const res = http.getResponse<Response>();
    const { status, headers, body } = toErrorResponse(exception, isPublicApi(req.path), requestLocale(req));
    if (status >= 500 && !(exception instanceof ApiError)) {
      this.logger.error(`${req.method} ${loggablePath(req.path)} failed`, exception instanceof Error ? exception.stack : String(exception));
    }
    if (res.headersSent) return;
    res.set(headers).status(status).json(body);
  }
}
