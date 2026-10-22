import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ApiError } from '../http/errors';
import type { ApiRequest } from '../http/request';
import { SessionService } from './session.service';

/**
 * First-party routes for a signed-in user. Resolves the cookie like the web app's currentUser()
 * (unseal → loadAccess → recordAccepted) and puts the CurrentUser on `req.user`; anything less
 * (no cookie, a revoked or idle session, a removed user, a demo past its end) answers 401.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    const user = await this.sessions.currentUser(req);
    if (!user) throw new ApiError(401, 'unauthorized', 'Sign in to continue.');
    req.user = user;
    return true;
  }
}

/** Public pages that change with the visitor: `req.user` is the CurrentUser or null, never a 401. */
@Injectable()
export class OptionalSessionGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    req.user = await this.sessions.currentUser(req);
    return true;
  }
}
