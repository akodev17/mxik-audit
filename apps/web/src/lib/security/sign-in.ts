// The one place a browser becomes signed in: password, Telegram, e-mail link, new account or invite.
// The logic is @tasnivo/domain/security/sign-in; this adapter supplies Next's cookie session and
// the request's user agent.
import { headers } from 'next/headers';
import { getSession } from '../session';
import {
  completePending as completeWith,
  hasPending as pendingIn,
  openSession as openWith,
  type OpenOptions,
  type PendingResult,
} from '@tasnivo/domain/security/sign-in';

export { clearPending, DELETED_PATH, TWO_FACTOR_PATH, type PendingResult } from '@tasnivo/domain/security/sign-in';

type Who = { id: string; orgId: string; email: string };

const userAgent = async (): Promise<string | null> => (await headers()).get('user-agent');

/** Where to send the browser next, or null when this user may not sign in (closed account, not an admin). */
export async function openSession(who: Who, options: OpenOptions): Promise<string | null> {
  return openWith(await getSession(), who, options, await userAgent());
}

/** Finishes a pending sign-in with an authenticator or recovery code. After too many wrong codes the password is asked again. */
export async function completePending(input: string): Promise<PendingResult> {
  return completeWith(await getSession(), input, await userAgent());
}

export async function hasPending(): Promise<boolean> {
  return pendingIn(await getSession());
}
