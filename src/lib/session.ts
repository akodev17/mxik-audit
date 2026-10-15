// Cookie session. No auth library: the MVP is one org, one user (per the brief),
// so iron-session plus a hashed password is the whole requirement.
import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';

export type SessionData = {
  userId?: string;
  orgId?: string;
  email?: string;
  /** Display only. Anything that matters re-checks the org's kind in the database. */
  demo?: boolean;
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

export type CurrentUser = { userId: string; orgId: string; email: string; demo: boolean };

/** Null when not signed in; callers redirect. */
export async function currentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  const { userId, orgId, email } = session;
  if (!userId || !orgId || !email) return null;
  return { userId, orgId, email, demo: session.demo === true };
}
