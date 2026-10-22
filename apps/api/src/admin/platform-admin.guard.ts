import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { isPlatformAdmin } from '@tasnivo/domain/admin';
import { ApiError } from '../http/errors';
import type { ApiRequest } from '../http/request';

/**
 * After SessionGuard: a platform admin (the user's flag, a confirmed address and ADMIN_EMAILS).
 * Anyone else gets the same 404 as a page that does not exist, as the admin pages and the CSV did.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const user = ctx.switchToHttp().getRequest<ApiRequest>().user;
    if (!user || !(await isPlatformAdmin(user.userId))) throw new ApiError(404, 'not_found', 'not found');
    return true;
  }
}
