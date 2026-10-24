import { Inject, Injectable, Optional, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { modulesOfApi, strictest, type ModuleStates } from '@tasnivo/contracts/feature-modules';
import { ApiError } from '../http/errors';
import type { ApiRequest } from '../http/request';
import { getModuleStates } from './module-states';

/** Where the guard reads the states; tests provide their own instead of the database. */
export const MODULE_STATES = Symbol('MODULE_STATES');

/** 404 for a path under a module that is not ENABLED, else null. */
export function moduleRefusal(path: string, states: ModuleStates): ApiError | null {
  const hit = strictest(modulesOfApi(path), states);
  return hit && hit.state !== 'ENABLED' ? new ApiError(404, 'not_found', 'not found') : null;
}

/**
 * Global, before every other guard: a request under the API prefix of a module that is COMING_SOON
 * or HIDDEN (packages/contracts/src/feature-modules.ts) gets the same 404 as a route that does not
 * exist. Admins are not exempt. Paths outside every module never read the states.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(@Optional() @Inject(MODULE_STATES) private readonly load: () => Promise<ModuleStates> = getModuleStates) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const path = ctx.switchToHttp().getRequest<ApiRequest>().path;
    if (modulesOfApi(path).length === 0) return true;
    const refusal = moduleRefusal(path, await this.load());
    if (refusal) throw refusal;
    return true;
  }
}
