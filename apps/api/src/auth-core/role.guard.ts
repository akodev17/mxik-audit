import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@tasnivo/contracts';
import { canWrite, isAdminRole } from '@tasnivo/domain/access';
import { isPlatformAdmin } from '@tasnivo/domain/admin';
import { ApiError } from '../http/errors';
import type { ApiRequest } from '../http/request';

export const ROLE_KEY = 'tasnivo:role';

/**
 * The registry's `role` of a session endpoint, after SessionGuard: `writer` = admin or accountant
 * (the actions' writer()), `admin` = org admin. A viewer reaching a writer route answers 403
 * `forbidden`; what the actions answered a demo org stays with the domain, inside the 200 answer.
 * `platformAdmin` = domain isPlatformAdmin (the flag on a confirmed account, read from the database).
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const role = this.reflector.getAllAndOverride<Role | undefined>(ROLE_KEY, [ctx.getHandler(), ctx.getClass()]) ?? 'any';
    const user = ctx.switchToHttp().getRequest<ApiRequest>().user;
    if (!user) throw new ApiError(401, 'unauthorized', 'Sign in to continue.');
    const allowed = role === 'writer' ? canWrite(user)
      : role === 'admin' ? isAdminRole(user)
        : role === 'platformAdmin' ? await isPlatformAdmin(user.userId)
          : true;
    if (!allowed) throw new ApiError(403, 'forbidden', 'Your role does not allow this.');
    return true;
  }
}
