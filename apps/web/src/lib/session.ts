// Cookie session. No auth library: the MVP is one org, one user (per the brief),
// so iron-session plus a hashed password is the whole requirement. The cookie's
// shape and the access query live in @tasnivo/domain/session; this adapter reads
// the cookie through Next and memoises per render.
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { recordAccepted } from '@tasnivo/domain/security/session-store';
import { assertSecret, loadAccess as readAccess, sessionOptions, type CurrentUser, type SessionData } from '@tasnivo/domain/session';

export { sessionOptions, type CurrentUser, type Role, type SessionData } from '@tasnivo/domain/session';

export async function getSession() {
  // cookies() first: it marks the page dynamic, so `next build` never tries to
  // prerender a signed-in page (and never needs the secret at build time).
  const store = await cookies();
  assertSecret();
  return getIronSession<SessionData>(store, sessionOptions);
}

/** Role and client scope come from the database, so a change applies at once. */
const loadAccess = cache(readAccess);

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
