// Entry points for server actions: signed in, with the right role.
import { canWrite, isAdminRole } from './access';
import { currentUser, type CurrentUser } from './session';

/** A signed-in user who may change data (admin or accountant). */
export async function writer(): Promise<CurrentUser | null> {
  const user = await currentUser();
  return user && canWrite(user) ? user : null;
}

/** A signed-in org admin. */
export async function admin(): Promise<CurrentUser | null> {
  const user = await currentUser();
  return user && isAdminRole(user) ? user : null;
}
