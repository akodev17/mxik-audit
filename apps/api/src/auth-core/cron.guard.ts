import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';
import { ApiError } from '../http/errors';
import { header, type ApiRequest } from '../http/request';

const MIN_SECRET = 16;

/** Compares in constant time; a different length is refused without comparing. */
export function bearerMatches(authorization: string | null, secret: string): boolean {
  const given = Buffer.from(authorization?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Cron endpoints: "Authorization: Bearer <CRON_SECRET>". While the secret is unset or shorter than
 * 16 characters every call answers 503 (as the web app's /api/cron routes do). Pair it with
 * @SkipCsrf(): cron is not a browser.
 */
@Injectable()
export class CronGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const secret = this.config.cronSecret?.trim() ?? '';
    if (secret.length < MIN_SECRET) throw new ApiError(503, 'cron_disabled', 'cron disabled');
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    if (!bearerMatches(header(req, 'authorization'), secret)) throw new ApiError(401, 'unauthorized', 'unauthorized');
    return true;
  }
}
