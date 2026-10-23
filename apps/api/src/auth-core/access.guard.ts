import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Endpoint } from '@tasnivo/contracts';
import { canWrite, isAdminRole } from '@tasnivo/domain/access';
import { isDemoOrg } from '@tasnivo/domain/demo';
import { i18nFor } from '@tasnivo/i18n/locale';
import { ApiError } from '../http/errors';
import { requestLocale, type ApiRequest } from '../http/request';

/** Metadata key under which `Route()` stores the registry entry of a handler. */
export const ENDPOINT = 'tasnivo:endpoint';

/**
 * After SessionGuard: an unconfirmed e-mail address first (403 `unverified`, except on the entries
 * marked `allowUnverified`: the code step, its resend and `me`), then the registry entry's `role` (writer = admin or accountant, admin) and
 * `noDemo` (refused for a demo org, read from the database each time, as the actions did).
 * Refusals are 403 with the code `forbidden` or `demo` and a message in the request's language.
 * `platformAdmin` is not decided here (always refused): the admin routes bring their own check.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const endpoint = this.reflector.get<Endpoint | undefined>(ENDPOINT, ctx.getHandler());
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    const user = req.user;
    if (!endpoint || !user) throw new ApiError(500, 'server_error', 'AccessGuard needs Route() and SessionGuard.');
    if (!user.verified && !endpoint.allowUnverified) throw new ApiError(403, 'unverified', i18nFor(requestLocale(req)).ta.verifyX.required);
    const message = (): string => i18nFor(requestLocale(req)).ta.firmX.errors.forbidden;
    const allowed = endpoint.role === 'admin' ? isAdminRole(user)
      : endpoint.role === 'writer' ? canWrite(user)
        : endpoint.role !== 'platformAdmin';
    if (!allowed) throw new ApiError(403, 'forbidden', message());
    if (endpoint.noDemo && await isDemoOrg(user.orgId)) throw new ApiError(403, 'demo', message());
    return true;
  }
}
