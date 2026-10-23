// Express middleware every response passes through: security headers and the request log.
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { allEndpoints, pathParams } from '@tasnivo/contracts';
import { securityHeaders } from '@tasnivo/domain/security/headers';
import type { ApiRequest } from './request';

/**
 * The web app's headers (CSP, nosniff, referrer, permissions, frame denial, HSTS in production)
 * from @tasnivo/domain/security/headers, plus `Cache-Control: no-store`: API answers are per user
 * and must not be cached by a browser or proxy unless a route says otherwise.
 */
export function securityHeadersMiddleware(env: Record<string, string | undefined> = process.env) {
  const headers = securityHeaders(env);
  return (_req: Request, res: Response, next: NextFunction): void => {
    for (const { key, value } of headers) res.setHeader(key, value);
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

export type LogLine = { method: string; path: string; status: number; ms: number; userId: string | null };

/** Path parameters that are bearer secrets: reset, verification, invite, demo and share tokens, one-time states. */
const SECRET_PARAMS = new Set(['token', 'state']);

/** Registry paths with such a parameter, as a pattern over the request path and the template logged instead. */
const SECRET_PATHS: { pattern: RegExp; shown: string }[] = allEndpoints()
  .filter((e) => pathParams(e.path).some((p) => SECRET_PARAMS.has(p)))
  .map((e) => ({
    pattern: new RegExp(`^${e.path.split(/\{\w+\}/).map((part) => part.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('[^/]+')}(?=/|$)`, 'i'),
    shown: e.path,
  }));

/**
 * The path as it may be logged: a secret path parameter (a password-reset or invite token…) is
 * replaced by its `{name}`, since anyone reading the logs could otherwise use it. The rest of the
 * path after the matched route is kept (`/api/share/{token}/pdf`).
 */
export function loggablePath(path: string): string {
  for (const { pattern, shown } of SECRET_PATHS) {
    const match = pattern.exec(path);
    if (match) return `${shown}${path.slice(match[0].length)}`;
  }
  return path;
}

/**
 * One line per finished request: method, path (never the query string, which may carry tokens,
 * and secret path segments redacted), status, duration and the signed-in user once a guard has
 * resolved one.
 */
export function requestLogMiddleware(write: (line: LogLine) => void = defaultWrite) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const started = performance.now();
    res.on('finish', () => {
      const user = (req as ApiRequest).user;
      write({ method: req.method, path: loggablePath(req.originalUrl.split('?')[0] ?? req.path), status: res.statusCode, ms: Math.round(performance.now() - started), userId: user?.userId ?? null });
    });
    next();
  };
}

const logger = new Logger('Request');

function defaultWrite({ method, path, status, ms, userId }: LogLine): void {
  logger.log(`${method} ${path} ${status} ${ms}ms${userId ? ` user=${userId}` : ''}`);
}
