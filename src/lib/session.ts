// Cookie session. No auth library: the MVP is one org, one user (per the brief),
// so iron-session plus a hashed password is the whole requirement.
import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { db } from './db';
import { recordAccepted, SESSION_MAX_AGE_SECONDS } from './security/session-store';

export type SessionData = {
  userId?: string;
  orgId?: string;
  email?: string;
  /** Display only. Anything that matters re-checks the org's kind in the database. */
  demo?: boolean;
  /** The client being worked on. Always re-checked against the org before use. */
  clientId?: string;
  /** The server-side session record (src/lib/security/session-store.ts). Required for every org except a demo. */
  sid?: string;
  /** Password accepted, two-factor code still to enter. */
  pendingUserId?: string;
  pendingVia?: string;
  pendingLanding?: string;
  pendingAt?: number;
  /** One-time state for binding Telegram from Settings, and when it was issued. */
  tgBind?: string;
  tgBindAt?: number;
};

const PASSWORD = process.env['SESSION_SECRET'] ?? '';

export const sessionOptions: SessionOptions = {
  password: PASSWORD,
  cookieName: 'mxik_audit_session',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
};

/** Throws early with a clear message rather than failing obscurely at runtime. */
function assertSecret(): void {
  if (PASSWORD.length < 32) {
    throw new Error(
      'SESSION_SECRET must be set to at least 32 characters. See .env.example.',
    );
  }
}

export async function getSession() {
  // cookies() first: it marks the page dynamic, so `next build` never tries to
  // prerender a signed-in page (and never needs the secret at build time).
  const store = await cookies();
  assertSecret();
  return getIronSession<SessionData>(store, sessionOptions);
}

export type Role = 'admin' | 'accountant' | 'viewer';

export type CurrentUser = {
  userId: string; orgId: string; email: string; demo: boolean; clientId: string | null;
  role: Role;
  /** Clients this user may open; null = every client of the org. */
  clientIds: string[] | null;
};

/** Role and client scope come from the database, so a change applies at once. */
const loadAccess = cache(async (userId: string, orgId: string): Promise<{ role: Role; clientIds: string[] | null; demoOrg: boolean } | null> => {
  const user = await db.user.findFirst({
    where: { id: userId, orgId, org: { deletedAt: null } },
    select: { role: true, assignments: { select: { clientId: true } }, org: { select: { kind: true } } },
  });
  if (!user) return null;
  const assigned = user.assignments.map((a) => a.clientId);
  return { role: user.role, clientIds: user.role === 'admin' || assigned.length === 0 ? null : assigned, demoOrg: user.org.kind === 'demo' };
});

/**
 * Null when not signed in; callers redirect. Once per request inside a render (React cache): the
 * metadata, the page and the tabs it renders share one session check. Outside a render (server
 * actions, route handlers) every call checks again.
 */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSession();
  const { userId, orgId, email } = session;
  if (!userId || !orgId || !email) return null;
  const access = await loadAccess(userId, orgId);
  if (!access) return null;
  if (!(await recordAccepted(session.sid, userId, access.demoOrg))) return null;
  return { userId, orgId, email, demo: session.demo === true, clientId: session.clientId ?? null, role: access.role, clientIds: access.clientIds };
});

/** Whether the user's org is a demo copy, from the database row currentUser already read (inside a render: no query of its own). */
export async function inDemoOrg(user: Pick<CurrentUser, 'userId' | 'orgId'>): Promise<boolean> {
  return (await loadAccess(user.userId, user.orgId))?.demoOrg === true;
}
