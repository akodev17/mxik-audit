// The session cookie outside Next: iron-session's framework-free sealData/unsealData with the
// web app's sessionOptions, so a cookie set by either app is valid in the other.
import { Inject, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { serialize, type SerializeOptions } from 'cookie';
import { sealData, unsealData } from 'iron-session';
import { recordAccepted } from '@tasnivo/domain/security/session-store';
import type { SignInSession } from '@tasnivo/domain/security/sign-in';
import { loadAccess, sessionOptions, type SessionData, type SignedInUser } from '@tasnivo/domain/session';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';
import { readCookie, type ApiRequest } from '../http/request';

/** The domain reads SessionService depends on; unit tests pass fakes. */
export type SessionDeps = { loadAccess: typeof loadAccess; recordAccepted: typeof recordAccepted };
export const SESSION_DEPS = Symbol('SESSION_DEPS');
export const sessionDeps: SessionDeps = { loadAccess, recordAccepted };

// iron-session's own defaults (dist/index.js): 14-day seal ttl; cookie httpOnly, secure, lax, path /.
const DEFAULT_TTL_SECONDS = 14 * 24 * 3600;
const MAX_COOKIE_BYTES = 4096;

export const SESSION_COOKIE = sessionOptions.cookieName;

/** Adds a Set-Cookie header, replacing one this response already carries for the same cookie (a second save wins). */
export function setCookie(res: Response, name: string, serialized: string): void {
  const current = res.getHeader('Set-Cookie');
  const others = (Array.isArray(current) ? current : typeof current === 'string' ? [current] : [])
    .filter((line) => !line.startsWith(`${name}=`));
  res.setHeader('Set-Cookie', [...others, serialized]);
}

@Injectable()
export class SessionService {
  private readonly ttl = sessionOptions.ttl ?? DEFAULT_TTL_SECONDS;
  private readonly cookieOptions: SerializeOptions = {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/',
    ...(sessionOptions.cookieOptions as SerializeOptions | undefined),
  };

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(SESSION_DEPS) private readonly deps: SessionDeps,
  ) {
    // sessionOptions captured SESSION_SECRET when @tasnivo/domain/session was first imported.
    if (sessionOptions.password !== config.sessionSecret) {
      throw new Error('SESSION_SECRET was read before the .env was loaded: import config/bootstrap-env before anything from @tasnivo/domain.');
    }
  }

  /** The cookie's fields; empty when there is no cookie or it is expired, tampered with or sealed with another secret. */
  async read(req: ApiRequest): Promise<SessionData> {
    const seal = readCookie(req, SESSION_COOKIE);
    if (!seal) return {};
    try {
      return await unsealData<SessionData>(seal, { password: sessionOptions.password, ttl: this.ttl });
    } catch {
      return {};
    }
  }

  /**
   * The web app's currentUser(): a cookie names the user, the database confirms the org still has
   * them (a demo past its end does not), and the server-side session record is live. `verified`
   * says whether the e-mail address is confirmed (AccessGuard refuses an unconfirmed user).
   */
  async currentUser(req: ApiRequest): Promise<SignedInUser | null> {
    const session = await this.read(req);
    const { userId, orgId, email } = session;
    if (!userId || !orgId || !email) return null;
    const access = await this.deps.loadAccess(userId, orgId);
    if (!access) return null;
    if (!(await this.deps.recordAccepted(session.sid, userId, access.demoOrg))) return null;
    return { userId, orgId, email, demo: session.demo === true, clientId: session.clientId ?? null, role: access.role, clientIds: access.clientIds, verified: access.verified };
  }

  async seal(data: SessionData): Promise<string> {
    return sealData(data, { password: sessionOptions.password, ttl: this.ttl });
  }

  /** Writes the sealed cookie with the web app's options. */
  async write(res: Response, data: SessionData): Promise<void> {
    const cookie = serialize(SESSION_COOKIE, await this.seal(data), this.cookieOptions);
    if (cookie.length > MAX_COOKIE_BYTES) throw new Error(`Session cookie too big (${cookie.length} bytes).`);
    setCookie(res, SESSION_COOKIE, cookie);
  }

  clear(res: Response): void {
    setCookie(res, SESSION_COOKIE, serialize(SESSION_COOKIE, '', { ...this.cookieOptions, maxAge: 0 }));
  }

  /** The cookie as the domain's sign-in code expects it: its fields plus a save() that writes it back on `res`. */
  async forSignIn(req: ApiRequest, res: Response): Promise<SignInSession> {
    const data = await this.read(req);
    // Not enumerable, as on iron-session's own session object: only the fields are sealed.
    return Object.defineProperty(data, 'save', { value: () => this.write(res, { ...data }), enumerable: false }) as SignInSession;
  }
}
