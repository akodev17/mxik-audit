// For pages that need a signed-in user (W3c's: dictionary, queue, dashboard, notifications): the
// API's answer for the session (lib/api/me.ts signedIn), or the sign-in page, as currentUser() +
// redirect did; and the role checks of domain access.ts, on that answer.
import { redirect } from 'next/navigation';
import { signedIn, type Me, type Role } from '@/lib/api/me';

export async function requireMe(): Promise<Me> {
  const me = await signedIn();
  if (!me) redirect('/sign-in');
  return me;
}

/** Admins and accountants change data; viewers only read. */
export const canWrite = (me: { role: Role }): boolean => me.role === 'admin' || me.role === 'accountant';
export const isAdminRole = (me: { role: Role }): boolean => me.role === 'admin';
