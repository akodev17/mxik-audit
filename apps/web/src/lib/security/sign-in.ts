// The pending sign-in as the web app's pages see it, through Next's cookie session. Signing in
// itself (password, Telegram, e-mail link, new account, invite) goes through the domain's forms
// (@tasnivo/domain/security/auth-forms and friends), which take the session as an argument.
import { getSession } from '../session';
import { hasPending as pendingIn } from '@tasnivo/domain/security/sign-in';

export { clearPending, DELETED_PATH, TWO_FACTOR_PATH, type PendingResult } from '@tasnivo/domain/security/sign-in';

export async function hasPending(): Promise<boolean> {
  return pendingIn(await getSession());
}
