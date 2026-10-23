// Every error leaves the API as JSON. /api/v1 keeps the public contract's envelope and codes
// (@tasnivo/domain/api/contract); first-party routes answer `{ error: { code, message } }` plus any
// extra fields the thrower attached. Unexpected failures are logged and never leak their message.
import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_STATUS, type ApiErrorCode } from '@tasnivo/domain/api/contract';
import { ApiError, codeForStatus, v1CodeForStatus } from './errors';
import { loggablePath } from './middleware';
import { isPublicApi, type ApiRequest } from './request';

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

/** The status, headers and JSON body an exception becomes. */
export function toErrorResponse(exception: unknown, publicApi: boolean): ErrorResponse {
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
  return { status, headers, body: { error: { code: code ?? codeForStatus(status), message }, ...extra } };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<ApiRequest>();
    const res = http.getResponse<Response>();
    const { status, headers, body } = toErrorResponse(exception, isPublicApi(req.path));
    if (status >= 500 && !(exception instanceof ApiError)) {
      this.logger.error(`${req.method} ${loggablePath(req.path)} failed`, exception instanceof Error ? exception.stack : String(exception));
    }
    if (res.headersSent) return;
    res.set(headers).status(status).json(body);
  }
}
