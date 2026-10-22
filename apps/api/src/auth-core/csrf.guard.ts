import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';
import { SKIP_CSRF } from '../http/decorators';
import { ApiError } from '../http/errors';
import { header, isPublicApi, type ApiRequest } from '../http/request';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'tasnivo';

/**
 * Global. The session cookie is SameSite=Lax; on top of that every mutating first-party request
 * must send `X-Requested-With: tasnivo` (a header a cross-site form cannot add and the API's
 * missing CORS policy will not let a cross-site script add) and, when the browser sends an Origin,
 * the origin of NEXT_PUBLIC_SITE_URL. Exempt: safe methods, /api/v1 (API keys, no cookie) and
 * routes marked @SkipCsrf() (provider callbacks, cron). With NEXT_PUBLIC_SITE_URL unset
 * (development) only the header is checked.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    if (SAFE_METHODS.has(req.method) || isPublicApi(req.path)) return true;
    if (this.reflector.getAllAndOverride<boolean | undefined>(SKIP_CSRF, [ctx.getHandler(), ctx.getClass()])) return true;
    if (header(req, CSRF_HEADER) !== CSRF_VALUE) {
      throw new ApiError(403, 'csrf', `Missing header "X-Requested-With: ${CSRF_VALUE}".`);
    }
    const origin = header(req, 'origin');
    if (origin !== null && this.config.siteOrigin !== null && origin !== this.config.siteOrigin) {
      throw new ApiError(403, 'csrf', 'Cross-origin request refused.');
    }
    return true;
  }
}
