// Cookie session. No auth library: the MVP is one org, one user (per the brief),
// so iron-session plus a hashed password is the whole requirement.
import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { db } from './db';

export type SessionData = {
  userId?: string;
  orgId?: string;
  email?: string;
  /** Display only. Anything that matters re-checks the org's kind in the database. */
  demo?: boolean;
  /** The client being worked on. Always re-checked against the org before use. */
  clientId?: string;
};

const PASSWORD = process.env['SESSION_SECRET'] ?? '';

export const sessionOptions: SessionOptions = {
  password: PASSWORD,
  cookieName: 'mxik_audit_session',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 7,
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
const loadAccess = cache(async (userId: string, orgId: string): Promise<{ role: Role; clientIds: string[] | null } | null> => {
  const user = await db.user.findFirst({
    where: { id: userId, orgId },
    select: { role: true, assignments: { select: { clientId: true } } },
  });
  if (!user) return null;
  const assigned = user.assignments.map((a) => a.clientId);
  return { role: user.role, clientIds: user.role === 'admin' || assigned.length === 0 ? null : assigned };
});

/** Null when not signed in; callers redirect. */
export async function currentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  const { userId, orgId, email } = session;
  if (!userId || !orgId || !email) return null;
  const access = await loadAccess(userId, orgId);
  if (!access) return null;
  return { userId, orgId, email, demo: session.demo === true, clientId: session.clientId ?? null, ...access };
}
